// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {SLMSToken} from "../src/SLMSToken.sol";
import {SLMSFaucet} from "../src/SLMSFaucet.sol";
import {LanternGameEconomy} from "../src/LanternGameEconomy.sol";
import {Vm} from "./Ecosystem.t.sol";

contract LanternGameEconomyTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    SLMSToken token;
    SLMSFaucet faucet;
    LanternGameEconomy game;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 key = 0x123456;
    uint256 paymentNonce;

    function setUp() public {
        vm.chainId(11155111);
        vm.warp(100_000);
        token = new SLMSToken(address(this));
        faucet = new SLMSFaucet(token);
        game = new LanternGameEconomy(token, address(faucet), vm.addr(key), address(this));
        token.mint(address(game), 100 ether);
        token.mint(alice, 100 ether);
        token.mint(bob, 100 ether);
        vm.prank(alice);
        token.approve(address(game), 100 ether);
        vm.prank(bob);
        token.approve(address(game), 100 ether);
        game.unpause();
    }

    function enter(address player) internal returns (uint256 id) {
        vm.prank(player);
        return game.enter(0, bytes32(++paymentNonce), block.timestamp + 10 minutes);
    }

    function result(uint256 id, bool won, bool full) internal view returns (LanternGameEconomy.Result memory) {
        (address player, uint256 deposited,,,) = game.rounds(id);
        return LanternGameEconomy.Result(id, player, deposited, won, full, block.timestamp + 1 hours);
    }

    function sign(LanternGameEconomy.Result memory r) internal returns (bytes memory) {
        (uint8 v, bytes32 a, bytes32 b) = vm.sign(key, game.hashResult(r));
        return abi.encodePacked(a, b, v);
    }

    function settle(uint256 id, bool won, bool full) internal {
        LanternGameEconomy.Result memory r = result(id, won, full);
        game.settle(r, sign(r));
    }

    function testReturnsAllEightTokensPlusBonusAndNoMint() public {
        uint256 supply = token.totalSupply();
        uint256 id = enter(alice);
        for (uint8 i; i < 7; ++i) {
            vm.prank(alice);
            game.purchase(id, i, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        }
        require(token.balanceOf(alice) == 92 ether && game.escrowed() == 8 ether);
        settle(id, true, false);
        require(token.balanceOf(alice) == 101 ether && token.totalSupply() == supply);
        require(game.escrowed() == 0 && game.bonusReserved() == 0);
    }

    function testDefeatRecyclesOnlyDepositsToFaucet() public {
        uint256 id = enter(alice);
        vm.prank(alice);
        game.purchase(id, 0, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        settle(id, false, false);
        require(token.balanceOf(alice) == 98 ether && token.balanceOf(address(faucet)) == 2 ether);
        require(game.bonusAllowance(alice) == 10 ether);
    }

    function testTenBonusesPerRollingDayButRefundsAlwaysContinue() public {
        for (uint256 i; i < 5; ++i) {
            settle(enter(alice), true, true);
        }
        require(token.balanceOf(alice) == 110 ether && game.bonusAllowance(alice) == 0);
        settle(enter(alice), true, true);
        require(token.balanceOf(alice) == 110 ether);
        settle(enter(bob), true, true);
        require(token.balanceOf(bob) == 102 ether);
        vm.warp(100_000 + 1 days - 1);
        require(game.bonusAllowance(alice) == 0);
        vm.warp(100_000 + 1 days);
        require(game.bonusAllowance(alice) == 10 ether);
        settle(enter(alice), true, true);
        require(token.balanceOf(alice) == 112 ether);
    }

    function testPartialAllowanceAndStaggeredExpiry() public {
        for (uint256 i; i < 9; ++i) {
            vm.warp(100_000 + i * 100);
            settle(enter(alice), true, false);
        }
        settle(enter(alice), true, true);
        require(game.bonusAllowance(alice) == 0 && token.balanceOf(alice) == 110 ether);
        vm.warp(100_000 + 1 days);
        require(game.bonusAllowance(alice) == 1 ether);
        settle(enter(alice), true, true);
        require(token.balanceOf(alice) == 111 ether);
        vm.warp(100_100 + 1 days);
        require(game.bonusAllowance(alice) == 1 ether);
    }

    function testCannotReplayOrChangeRecipientOrDeposit() public {
        uint256 id = enter(alice);
        LanternGameEconomy.Result memory r = result(id, true, true);
        bytes memory sig = sign(r);
        r.player = bob;
        vm.expectRevert();
        game.settle(r, sig);
        r.player = alice;
        r.deposited += 1 ether;
        bytes memory altered = sign(r);
        vm.expectRevert();
        game.settle(r, altered);
        r.deposited -= 1 ether;
        game.settle(r, sig);
        vm.expectRevert();
        game.settle(r, sig);
        vm.prank(alice);
        vm.expectRevert();
        game.purchase(id, 0, bytes32(++paymentNonce), block.timestamp + 10 minutes);
    }

    function testNewPurchaseInvalidatesOldResult() public {
        uint256 id = enter(alice);
        LanternGameEconomy.Result memory r = result(id, true, true);
        bytes memory sig = sign(r);
        vm.prank(alice);
        game.purchase(id, 0, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        vm.expectRevert();
        game.settle(r, sig);
        settle(id, true, true);
        require(token.balanceOf(alice) == 102 ether);
    }

    function testOneTimeStockAndRepeatableHealingWithoutSpendingCap() public {
        uint256 id = enter(alice);
        for (uint8 i; i < 8; ++i) {
            vm.prank(alice);
            game.purchase(id, i, bytes32(++paymentNonce), block.timestamp + 10 minutes);
            vm.prank(alice);
            vm.expectRevert();
            game.purchase(id, i, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        }
        for (uint8 i; i < 4; ++i) {
            vm.prank(alice);
            game.purchase(id, 8, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        }
        require(game.escrowed() == 13 ether);
        vm.prank(bob);
        vm.expectRevert();
        game.purchase(id, 8, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        vm.prank(alice);
        vm.expectRevert();
        game.purchase(id, 9, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        settle(id, true, true);
        require(token.balanceOf(alice) == 102 ether);
    }

    function testReserveCannotUseDepositsAndPauseStillAllowsSettlement() public {
        LanternGameEconomy empty = new LanternGameEconomy(token, address(faucet), vm.addr(key), address(this));
        empty.unpause();
        vm.prank(alice);
        token.approve(address(empty), 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        empty.enter(0, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        require(empty.nextRoundId() == 1 && empty.escrowed() == 0);
        uint256 id = enter(alice);
        require(game.availableBonusPool() == 98 ether);
        game.pause();
        vm.prank(alice);
        vm.expectRevert();
        game.enter(0, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        settle(id, true, true);
        require(token.balanceOf(alice) == 102 ether);
    }

    function testWrongSignerChainExpiryAndContract() public {
        uint256 id = enter(alice);
        LanternGameEconomy.Result memory r = result(id, true, false);
        bytes memory sig = sign(r);
        vm.chainId(1);
        vm.expectRevert();
        game.settle(r, sig);
        vm.chainId(11155111);
        LanternGameEconomy other = new LanternGameEconomy(token, address(faucet), vm.addr(key), address(this));
        token.mint(address(other), 2 ether);
        other.unpause();
        vm.prank(alice);
        token.approve(address(other), 1 ether);
        vm.prank(alice);
        other.enter(0, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        vm.expectRevert();
        other.settle(r, sig);
        game.pause();
        game.setSigner(vm.addr(0x999));
        vm.expectRevert();
        game.settle(r, sig);
        game.setSigner(vm.addr(key));
        vm.warp(r.deadline + 1);
        vm.expectRevert();
        game.settle(r, sig);
    }

    function testClassBindingAndPaymentRecoveryIds() public {
        bytes32 entryId = keccak256("entry-recovery");
        vm.prank(alice);
        uint256 id = game.enter(5, entryId, block.timestamp + 10 minutes);
        (,,,, uint8 classId) = game.rounds(id);
        require(classId == 5 && game.paymentRound(alice, entryId) == id);
        vm.prank(alice);
        vm.expectRevert();
        game.enter(0, entryId, block.timestamp + 10 minutes);
        require(token.balanceOf(alice) == 99 ether);
        bytes32 healId = keccak256("healing-recovery");
        vm.prank(alice);
        game.purchase(id, 8, healId, block.timestamp + 10 minutes);
        vm.prank(alice);
        vm.expectRevert();
        game.purchase(id, 8, healId, block.timestamp + 10 minutes);
        require(token.balanceOf(alice) == 98 ether && game.paymentRound(alice, healId) == id);
        vm.prank(bob);
        uint256 other = game.enter(1, entryId, block.timestamp + 10 minutes);
        require(other != id && game.paymentRound(bob, entryId) == other);
    }

    function testInvalidClassOrEmptyPaymentIdCannotCharge() public {
        vm.prank(alice);
        vm.expectRevert();
        game.enter(6, bytes32(uint256(123)), block.timestamp + 10 minutes);
        vm.prank(alice);
        vm.expectRevert();
        game.enter(0, bytes32(0), block.timestamp + 10 minutes);
        require(token.balanceOf(alice) == 100 ether && game.nextRoundId() == 1);
    }

    function testSignerOutageRotationPreservesDepositsAndSettlesWhilePaused() public {
        uint256 id = enter(alice);
        LanternGameEconomy.Result memory r = result(id, true, true);
        bytes memory oldSignature = sign(r);
        vm.prank(bob);
        vm.expectRevert();
        game.setSigner(bob);
        vm.expectRevert();
        game.setSigner(vm.addr(0x999));
        game.pause();
        vm.expectRevert();
        game.setSigner(address(this));
        game.setSigner(vm.addr(0x999));
        require(game.escrowed() == 1 ether && game.bonusReserved() == 2 ether);
        vm.expectRevert();
        game.settle(r, oldSignature);
        (uint8 v, bytes32 a, bytes32 b) = vm.sign(0x999, game.hashResult(r));
        vm.prank(bob);
        game.settle(r, abi.encodePacked(a, b, v));
        require(token.balanceOf(alice) == 102 ether && token.balanceOf(bob) == 100 ether);
        require(game.escrowed() == 0 && game.bonusReserved() == 0);
    }

    function testExpiredReviewCannotChargeAfterItIsReleased() public {
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 paymentId = keccak256("expired-entry");
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert();
        game.enter(0, paymentId, deadline);
        require(game.paymentRound(alice, paymentId) == 0 && token.balanceOf(alice) == 100 ether);
        uint256 id = enter(alice);
        vm.prank(alice);
        vm.expectRevert();
        game.purchase(id, 8, keccak256("expired-heal"), deadline);
        require(game.escrowed() == 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        game.enter(0, keccak256("long-deadline"), block.timestamp + 16 minutes);
    }

    function testFuzzConservation(uint8 actions, bool won, bool full) public {
        uint256 id = enter(alice);
        uint256 count = uint256(actions) % 30;
        for (uint256 i; i < count; ++i) {
            vm.prank(alice);
            game.purchase(id, 8, bytes32(++paymentNonce), block.timestamp + 10 minutes);
        }
        uint256 used = (count + 1) * 1 ether;
        settle(id, won, won && full);
        uint256 bonus = won ? (full ? 2 ether : 1 ether) : 0;
        require(token.balanceOf(alice) == (won ? 100 ether + bonus : 100 ether - used));
        require(
            token.balanceOf(address(game)) + token.balanceOf(alice) + token.balanceOf(bob)
                    + token.balanceOf(address(faucet)) == token.totalSupply()
        );
    }
}
