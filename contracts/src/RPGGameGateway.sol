// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract RPGGameGateway is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Round {
        address payer;
        bool kit;
        uint64 startedAt;
    }
    IERC20 public immutable token;
    address public immutable treasury;
    uint256 public constant ENTRY_PRICE = 1 ether;
    uint256 public constant KIT_PRICE = 1 ether;
    uint256 public nextRoundId = 1;
    mapping(uint256 => Round) public rounds;
    event RoundStarted(uint256 indexed roundId, address indexed payer, uint256 amount, bool kit);
    error InvalidConfiguration();

    constructor(IERC20 token_, address owner_, address treasury_) Ownable(owner_) {
        if (block.chainid != 11155111 || address(token_).code.length == 0 || treasury_ == address(0)) {
            revert InvalidConfiguration();
        }
        token = token_;
        treasury = treasury_;
    }

    function startRound(bool kit) external nonReentrant whenNotPaused returns (uint256 id) {
        uint256 amount = ENTRY_PRICE + (kit ? KIT_PRICE : 0);
        id = nextRoundId++;
        rounds[id] = Round(msg.sender, kit, uint64(block.timestamp));
        token.safeTransferFrom(msg.sender, treasury, amount);
        emit RoundStarted(id, msg.sender, amount, kit);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
