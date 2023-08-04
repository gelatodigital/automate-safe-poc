// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
import "hardhat/console.sol";

contract CounterTest {
    address public owner;
    uint256 public count;
    uint256 public lastExecuted;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only Owner");
        _;
    }

    // solhint-disable not-rely-on-time
    function increaseCount(uint256 amount) external {
        // @dev commented out to test multisend
        // require(((block.timestamp - lastExecuted) > 180), "Counter: increaseCount: Time not elapsed");

        count += amount;
        lastExecuted = block.timestamp;
    }

    receive() external payable {
        console.log("----- receive:", msg.value);
    }

    function withdraw() external onlyOwner returns (bool) {
        (bool result, ) = payable(msg.sender).call{value: address(this).balance}("");
        return result;
    }
}
