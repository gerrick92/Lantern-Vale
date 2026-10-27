// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract SLMSToken is ERC20Capped, Ownable2Step {
    error SepoliaOnly();

    constructor(address owner_) ERC20("Lantern Vale Glow", "GLOW") ERC20Capped(1_000_000 ether) Ownable(owner_) {
        if (block.chainid != 11155111) revert SepoliaOnly();
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
