// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface RecyclingPool {
    function token() external view returns (IERC20);
}

/// @notice Undeployed settlement candidate. Requires authoritative game and receipt integration.
/// @dev Deposits are segregated from the funded bonus reserve. No administrator withdrawal exists.
contract LanternGameEconomy is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant PRICE = 1 ether;
    uint256 public constant BOSS_BONUS = 1 ether;
    uint256 public constant FULL_CLEAR_BONUS = 2 ether;
    uint256 public constant DAILY_BONUS_LIMIT = 10 ether;
    uint256 public constant WINDOW = 1 days;

    // 0..5: weapon, armor, potion, ether, spark, mend. 6..7: NPCs. 8: repeatable healing.
    struct Round {
        address player;
        uint256 deposited;
        uint16 purchases;
        bool settled;
        uint8 classId;
    }

    struct Result {
        uint256 roundId;
        address player;
        uint256 deposited;
        bool won;
        bool fullClear;
        uint256 deadline;
    }

    struct Award {
        uint64 at;
        uint192 amount;
    }
    bytes32 public constant RESULT_TYPEHASH =
        keccak256("Result(uint256 roundId,address player,uint256 deposited,bool won,bool fullClear,uint256 deadline)");
    IERC20 public immutable token;
    address public immutable recyclingPool;
    address public signer;
    uint256 public nextRoundId = 1;
    uint256 public escrowed;
    uint256 public bonusReserved;
    mapping(uint256 => Round) public rounds;
    // A wallet-generated ID makes retries safe, including repeatable healing.
    // It is an idempotency key, never evidence of identity or randomness.
    mapping(address => mapping(bytes32 => uint256)) public paymentRound;
    mapping(address => Award[10]) private awards;
    event Entered(
        uint256 indexed roundId, address indexed player, bytes32 indexed paymentId, uint8 classId, uint256 amount
    );
    event Purchased(
        uint256 indexed roundId, uint8 indexed item, bytes32 indexed paymentId, uint256 amount, uint256 totalDeposited
    );
    event Settled(
        uint256 indexed roundId, address indexed player, bool won, uint256 returned, uint256 bonus, uint256 recycled
    );
    event SignerChanged(address indexed previous, address indexed current);
    error InvalidConfiguration();
    error InvalidAction();
    error Unfunded();

    constructor(IERC20 token_, address recyclingPool_, address signer_, address owner_)
        EIP712("LanternValeSettlement", "1")
        Ownable(owner_)
    {
        if (
            block.chainid != 11155111 || address(token_).code.length == 0 || recyclingPool_.code.length == 0
                || signer_ == address(0) || signer_ == owner_ || recyclingPool_ == address(this)
                || address(RecyclingPool(recyclingPool_).token()) != address(token_)
        ) revert InvalidConfiguration();
        token = token_;
        recyclingPool = recyclingPool_;
        signer = signer_;
        _pause();
    }

    function availableBonusPool() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        return balance > escrowed + bonusReserved ? balance - escrowed - bonusReserved : 0;
    }

    function bonusAllowance(address player) public view returns (uint256) {
        uint256 used;
        for (uint256 i; i < 10; ++i) {
            Award memory award = awards[player][i];
            if (award.amount != 0 && block.timestamp < uint256(award.at) + WINDOW) used += award.amount;
        }
        return DAILY_BONUS_LIMIT - used;
    }

    function enter(uint8 classId, bytes32 paymentId, uint256 deadline)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        if (
            block.chainid != 11155111 || block.timestamp > deadline || deadline > block.timestamp + 15 minutes
                || classId > 5 || paymentId == bytes32(0) || paymentRound[msg.sender][paymentId] != 0
        ) revert InvalidAction();
        if (availableBonusPool() < FULL_CLEAR_BONUS) revert Unfunded();
        id = nextRoundId++;
        rounds[id] = Round(msg.sender, PRICE, 0, false, classId);
        paymentRound[msg.sender][paymentId] = id;
        escrowed += PRICE;
        bonusReserved += FULL_CLEAR_BONUS;
        token.safeTransferFrom(msg.sender, address(this), PRICE);
        emit Entered(id, msg.sender, paymentId, classId, PRICE);
    }

    function purchase(uint256 id, uint8 item, bytes32 paymentId, uint256 deadline) external whenNotPaused nonReentrant {
        Round storage round = rounds[id];
        if (
            block.chainid != 11155111 || block.timestamp > deadline || deadline > block.timestamp + 15 minutes
                || round.player != msg.sender || round.settled || item > 8 || paymentId == bytes32(0)
                || paymentRound[msg.sender][paymentId] != 0
        ) {
            revert InvalidAction();
        }
        if (item < 8) {
            uint16 bit = uint16(1) << item;
            if (round.purchases & bit != 0) revert InvalidAction();
            round.purchases |= bit;
        }
        round.deposited += PRICE;
        paymentRound[msg.sender][paymentId] = id;
        escrowed += PRICE;
        token.safeTransferFrom(msg.sender, address(this), PRICE);
        emit Purchased(id, item, paymentId, PRICE, round.deposited);
    }

    function hashResult(Result calldata result) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RESULT_TYPEHASH,
                    result.roundId,
                    result.player,
                    result.deposited,
                    result.won,
                    result.fullClear,
                    result.deadline
                )
            )
        );
    }

    /// @dev Relayers may settle, but all returned tokens go to the recorded player.
    /// Pausing new payments does not block returning deposits on a verified victory.
    function settle(Result calldata result, bytes calldata signature) external nonReentrant {
        Round storage round = rounds[result.roundId];
        if (
            block.chainid != 11155111 || round.player == address(0) || round.settled || round.player != result.player
                || round.deposited != result.deposited || block.timestamp > result.deadline
                || (!result.won && result.fullClear) || ECDSA.recover(hashResult(result), signature) != signer
        ) revert InvalidAction();
        round.settled = true;
        escrowed -= round.deposited;
        bonusReserved -= FULL_CLEAR_BONUS;
        uint256 bonus;
        if (result.won) {
            bonus = result.fullClear ? FULL_CLEAR_BONUS : BOSS_BONUS;
            uint256 allowance = bonusAllowance(result.player);
            if (bonus > allowance) bonus = allowance;
            if (bonus != 0) {
                for (uint256 i; i < 10; ++i) {
                    Award storage award = awards[result.player][i];
                    if (award.amount == 0 || block.timestamp >= uint256(award.at) + WINDOW) {
                        award.at = uint64(block.timestamp);
                        award.amount = uint192(bonus);
                        break;
                    }
                }
            }
            token.safeTransfer(round.player, round.deposited + bonus);
        } else {
            token.safeTransfer(recyclingPool, round.deposited);
        }
        emit Settled(
            result.roundId,
            round.player,
            result.won,
            result.won ? round.deposited : 0,
            bonus,
            result.won ? 0 : round.deposited
        );
    }

    function setSigner(address next) external onlyOwner whenPaused {
        if (next == address(0) || next == owner()) revert InvalidConfiguration();
        emit SignerChanged(signer, next);
        signer = next;
    }

    function _transferOwnership(address next) internal override {
        if (next != address(0) && next == signer) revert InvalidConfiguration();
        super._transferOwnership(next);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
