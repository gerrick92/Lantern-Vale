// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {SLMSToken} from "../src/SLMSToken.sol";
import {SLMSFaucet} from "../src/SLMSFaucet.sol";
import {RPGGameGateway} from "../src/RPGGameGateway.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";

interface Vm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert() external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
}

contract EcosystemTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    SLMSToken token;
    SLMSFaucet faucet;
    RPGGameGateway gateway;
    RewardDistributor rewards;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 signerKey = 0x123456;

    function setUp() public {
        vm.chainId(11155111);
        vm.warp(100_000);
        token = new SLMSToken(address(this));
        faucet = new SLMSFaucet(token);
        gateway = new RPGGameGateway(token, address(this), address(this));
        rewards = new RewardDistributor(token, gateway, vm.addr(signerKey), address(this));
        token.mint(address(faucet), 100 ether);
        token.mint(address(rewards), 100 ether);
        token.mint(alice, 100 ether);
        rewards.unpause();
    }

    function paid(address player, bool kit) internal returns (uint256) {
        vm.startPrank(player);
        token.approve(address(gateway), kit ? 2 ether : 1 ether);
        uint256 id = gateway.startRound(kit);
        vm.stopPrank();
        return id;
    }

    function claimData(uint256 id) internal view returns (RewardDistributor.Reward memory) {
        return RewardDistributor.Reward(id, alice, 3 ether, id, block.timestamp + 1 hours);
    }

    function signature(RewardDistributor.Reward memory reward) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, rewards.hashReward(reward));
        return abi.encodePacked(r, s, v);
    }

    function testOwnerMintCapAndBurn() public {
        token.mint(alice, token.cap() - token.totalSupply());
        vm.expectRevert();
        token.mint(alice, 1);
        vm.prank(alice);
        token.burn(1 ether);
        token.mint(bob, 1 ether);
        require(token.totalSupply() == token.cap());
    }

    function testUnauthorizedMint() public {
        vm.prank(alice);
        vm.expectRevert();
        token.mint(alice, 1);
    }

    function testTransferAndSelfBurn() public {
        vm.startPrank(alice);
        token.transfer(bob, 10 ether);
        token.burn(2 ether);
        vm.stopPrank();
        require(token.balanceOf(bob) == 10 ether && token.balanceOf(alice) == 88 ether);
    }

    function testFaucetBoundaryAndSeparateWallet() public {
        vm.prank(alice);
        faucet.claim();
        vm.prank(bob);
        faucet.claim();
        vm.warp(100_000 + 1 days - 1);
        vm.prank(alice);
        vm.expectRevert();
        faucet.claim();
        vm.warp(100_000 + 1 days);
        vm.prank(alice);
        faucet.claim();
        require(token.balanceOf(alice) == 110 ether);
    }

    function testEmptyFaucetDoesNotConsumeCooldown() public {
        SLMSFaucet empty = new SLMSFaucet(token);
        vm.prank(alice);
        vm.expectRevert();
        empty.claim();
        require(empty.nextClaimAt(alice) == 0);
        token.mint(address(empty), 5 ether);
        vm.prank(alice);
        empty.claim();
    }

    function testPaidKitAndNoFreeEntry() public {
        vm.prank(alice);
        vm.expectRevert();
        gateway.startRound(false);
        require(gateway.nextRoundId() == 1);
        uint256 id = paid(alice, true);
        (address payer, bool kit,) = gateway.rounds(id);
        require(
            payer == alice && kit && token.balanceOf(alice) == 98 ether && token.allowance(alice, address(gateway)) == 0
        );
    }

    function testVerifiedClaimAndReplay() public {
        RewardDistributor.Reward memory r = claimData(paid(alice, false));
        bytes memory sig = signature(r);
        vm.prank(alice);
        rewards.claim(r, sig);
        require(token.balanceOf(alice) == 102 ether);
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(r, sig);
    }

    function testWrongRecipientAmountAndUnpaidRound() public {
        RewardDistributor.Reward memory r = claimData(paid(alice, false));
        bytes memory sig = signature(r);
        vm.prank(bob);
        vm.expectRevert();
        rewards.claim(r, sig);
        r.amount = 4 ether;
        sig = signature(r);
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(r, sig);
        r = claimData(999);
        sig = signature(r);
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(r, sig);
    }

    function testExpiredWrongSignerAndCrossChain() public {
        RewardDistributor.Reward memory r = claimData(paid(alice, false));
        bytes memory sig = signature(r);
        vm.chainId(1);
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(r, sig);
        vm.chainId(11155111);
        (uint8 v, bytes32 a, bytes32 b) = vm.sign(0x555, rewards.hashReward(r));
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(r, abi.encodePacked(a, b, v));
        vm.warp(r.deadline + 1);
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(r, sig);
    }

    function testDailyLimitNonceAndSignerRotation() public {
        RewardDistributor.Reward memory r = claimData(paid(alice, false));
        bytes memory sig = signature(r);
        vm.prank(alice);
        rewards.claim(r, sig);
        RewardDistributor.Reward memory second = claimData(paid(alice, false));
        sig = signature(second);
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(second, sig);
        vm.warp(block.timestamp + 1 days);
        second.deadline = block.timestamp + 1 hours;
        second.nonce = r.nonce;
        sig = signature(second);
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(second, sig);
        second.nonce = 999;
        sig = signature(second);
        rewards.pause();
        rewards.setSigner(vm.addr(0x555));
        rewards.unpause();
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(second, sig);
    }

    function testPoolExhaustionRollsBackClaim() public {
        RewardDistributor.Reward memory r = claimData(paid(alice, false));
        rewards.pause();
        vm.warp(block.timestamp + 2 days);
        rewards.emergencyWithdraw(address(this), 100 ether);
        rewards.unpause();
        r.deadline = block.timestamp + 1 hours;
        bytes memory sig = signature(r);
        vm.prank(alice);
        vm.expectRevert();
        rewards.claim(r, sig);
        require(!rewards.claimedRounds(r.roundId));
    }

    function testPauseAndWithdrawalDelay() public {
        vm.prank(alice);
        vm.expectRevert();
        gateway.pause();
        gateway.pause();
        vm.prank(alice);
        token.approve(address(gateway), 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        gateway.startRound(false);
        rewards.pause();
        vm.expectRevert();
        rewards.emergencyWithdraw(alice, 1);
    }

    function testWrongDeploymentChain() public {
        vm.chainId(1);
        vm.expectRevert();
        new SLMSToken(address(this));
    }

    function testSignerCannotBecomeOwnerEvenAfterPendingTransfer() public {
        address next = vm.addr(0x555);
        rewards.transferOwnership(next);
        rewards.pause();
        rewards.setSigner(next);
        vm.prank(next);
        vm.expectRevert();
        rewards.acceptOwnership();
        require(rewards.owner() == address(this));
        rewards.setSigner(vm.addr(signerKey));
        vm.prank(next);
        rewards.acceptOwnership();
        require(rewards.owner() == next && rewards.signer() != next);
    }

    function testGatewayPauseRecoveryAndCrossDistributorReplay() public {
        gateway.pause();
        vm.prank(alice);
        vm.expectRevert();
        gateway.unpause();
        gateway.unpause();
        RewardDistributor.Reward memory r = claimData(paid(alice, false));
        bytes memory sig = signature(r);
        RewardDistributor other = new RewardDistributor(token, gateway, vm.addr(signerKey), address(this));
        token.mint(address(other), 3 ether);
        other.unpause();
        vm.prank(alice);
        vm.expectRevert();
        other.claim(r, sig);
        require(!other.claimedRounds(r.roundId) && !other.spentNonces(r.nonce));
    }

    function testFuzzSupplyCap(uint128 amount) public {
        uint256 available = token.cap() - token.totalSupply();
        uint256 value = uint256(amount) % (available + 1);
        token.mint(alice, value);
        require(token.totalSupply() <= token.cap());
    }

    function testFuzzPaymentNeverFree(uint96 value) public {
        vm.prank(alice);
        token.approve(address(gateway), uint256(value) % 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        gateway.startRound(false);
        require(gateway.nextRoundId() == 1);
    }
}
