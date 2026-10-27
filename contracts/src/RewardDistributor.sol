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
import {RPGGameGateway} from "./RPGGameGateway.sol";

contract RewardDistributor is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Reward {
        uint256 roundId;
        address recipient;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }
    bytes32 public constant REWARD_TYPEHASH =
        keccak256("Reward(uint256 roundId,address recipient,uint256 amount,uint256 nonce,uint256 deadline)");
    uint256 public constant REWARD = 3 ether;
    IERC20 public immutable token;
    RPGGameGateway public immutable gateway;
    address public signer;
    mapping(uint256 => bool) public claimedRounds;
    mapping(uint256 => bool) public spentNonces;
    mapping(address => uint256) public nextRewardAt;
    uint256 public pausedAt;
    event RewardPaid(uint256 indexed roundId, address indexed recipient, uint256 amount, uint256 nonce);
    event SignerChanged(address indexed previous, address indexed current);
    error InvalidClaim();
    error InvalidConfiguration();
    error WithdrawalLocked();

    constructor(IERC20 token_, RPGGameGateway gateway_, address signer_, address owner_)
        EIP712("MosslightReward", "1")
        Ownable(owner_)
    {
        if (
            block.chainid != 11155111 || address(token_).code.length == 0 || address(gateway_).code.length == 0
                || address(gateway_.token()) != address(token_) || signer_ == address(0) || signer_ == owner_
        ) revert InvalidConfiguration();
        token = token_;
        gateway = gateway_;
        signer = signer_;
        _pause();
        pausedAt = block.timestamp;
    }

    function hashReward(Reward calldata reward) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    REWARD_TYPEHASH, reward.roundId, reward.recipient, reward.amount, reward.nonce, reward.deadline
                )
            )
        );
    }

    function claim(Reward calldata reward, bytes calldata signature) external nonReentrant whenNotPaused {
        (address payer,,) = gateway.rounds(reward.roundId);
        if (
            block.chainid != 11155111 || msg.sender != reward.recipient || payer != msg.sender
                || reward.amount != REWARD || block.timestamp > reward.deadline || claimedRounds[reward.roundId]
                || spentNonces[reward.nonce] || block.timestamp < nextRewardAt[msg.sender]
        ) revert InvalidClaim();
        if (ECDSA.recover(hashReward(reward), signature) != signer) revert InvalidClaim();
        claimedRounds[reward.roundId] = true;
        spentNonces[reward.nonce] = true;
        nextRewardAt[msg.sender] = block.timestamp + 1 days;
        token.safeTransfer(reward.recipient, reward.amount);
        emit RewardPaid(reward.roundId, reward.recipient, reward.amount, reward.nonce);
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
        pausedAt = block.timestamp;
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function emergencyWithdraw(address recipient, uint256 amount) external onlyOwner whenPaused nonReentrant {
        if (block.timestamp < pausedAt + 2 days || recipient == address(0)) revert WithdrawalLocked();
        token.safeTransfer(recipient, amount);
    }
}
