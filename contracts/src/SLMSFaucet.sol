// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SLMSFaucet is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    uint256 public constant CLAIM_AMOUNT = 5 ether;
    uint256 public constant COOLDOWN = 1 days;
    mapping(address => uint256) public nextClaimAt;
    event Claimed(address indexed recipient, uint256 amount, uint256 nextClaimAt);
    error Cooldown(uint256 availableAt);
    error EmptyPool();
    error InvalidConfiguration();

    constructor(IERC20 token_) {
        if (block.chainid != 11155111 || address(token_).code.length == 0) revert InvalidConfiguration();
        token = token_;
    }

    function claim() external nonReentrant {
        if (block.timestamp < nextClaimAt[msg.sender]) revert Cooldown(nextClaimAt[msg.sender]);
        if (token.balanceOf(address(this)) < CLAIM_AMOUNT) revert EmptyPool();
        nextClaimAt[msg.sender] = block.timestamp + COOLDOWN;
        token.safeTransfer(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT, nextClaimAt[msg.sender]);
    }
}
