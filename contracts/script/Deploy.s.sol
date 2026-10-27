// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {SLMSToken} from "../src/SLMSToken.sol";
import {SLMSFaucet} from "../src/SLMSFaucet.sol";
import {RPGGameGateway} from "../src/RPGGameGateway.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";

interface DeployVm {
    function envAddress(string calldata) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract Deploy {
    bool private constant LEGACY_DEPLOYMENT_ENABLED = false;
    DeployVm private constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external {
        require(LEGACY_DEPLOYMENT_ENABLED, "Legacy economy superseded: complete LanternGameEconomy integration first");
        require(block.chainid == 11155111, "Sepolia only");
        address owner = vm.envAddress("DEPLOYER_ADDRESS");
        address signer = vm.envAddress("REWARD_SIGNER_ADDRESS");
        require(owner != signer, "Separate signer required");
        vm.startBroadcast();
        SLMSToken token = new SLMSToken(owner);
        SLMSFaucet faucet = new SLMSFaucet(token);
        RPGGameGateway gateway = new RPGGameGateway(token, owner, owner);
        RewardDistributor rewards = new RewardDistributor(token, gateway, signer, owner);
        token.mint(address(faucet), 5_000 ether);
        token.mint(address(rewards), 10_000 ether);
        token.mint(owner, 85_000 ether);
        vm.stopBroadcast();
    }
}
