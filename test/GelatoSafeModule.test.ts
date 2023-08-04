/* eslint-disable @typescript-eslint/no-explicit-any */
import { Signer } from "@ethersproject/abstract-signer";
import { expect } from "chai";
import hre = require("hardhat");

import { getAutomateAddress, getGelatoAddress, getTreasuryAddress } from "../hardhat/config/addresses";
// import { buildSafeTransaction, executeTx, safeApproveHash } from "../src/utils";
const { ethers, deployments } = hre;
import { CounterTest, GelatoSafeModule, ITaskTreasuryUpgradable, TestAvatar, IAutomate } from "../typechain";
import { encodeTimeArgs, fastForwardTime, getTimeStampNow, Module } from "./utils";

// const SAFE_PROXY_FACTORY_ADDRESS = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
// const SAFE_IMPLEMENTATION_ADDRESS = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
// const SALT = ethers.BigNumber.from("42069");
const TASK_TREASURY_ADDRESS = getTreasuryAddress("hardhat");
const GELATO_ADDRESS = getGelatoAddress("hardhat");
const AUTOMATE_ADDRESS = getAutomateAddress("hardhat");
const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADD = ethers.constants.AddressZero;
const FEE = ethers.utils.parseEther("0.1");
const INTERVAL = 24 * 60 * 60 * 1000;
const CALL = 0;
const DELEGATECALL = 1;

describe("GelatoSafeModule tests", function () {
  this.timeout(0);

  let user: Signer;
  let userAddress: string;

  let contributor: Signer;
  let contributorAddress: string;

  let executor: Signer;
  // let executorAddress: string;

  let counter: CounterTest;
  let gelatoSafeModule: GelatoSafeModule;
  let avatar: TestAvatar;
  let taskTreasury: ITaskTreasuryUpgradable;
  let automate: IAutomate;

  before(async function () {
    await deployments.fixture();

    [, user, contributor] = await ethers.getSigners();
    userAddress = await user.getAddress();
    contributorAddress = await contributor.getAddress();

    counter = await ethers.getContract("CounterTest");
    gelatoSafeModule = await ethers.getContract("GelatoSafeModule");
    avatar = await ethers.getContract("TestAvatar", user);
    automate = await ethers.getContractAt("contracts/interfaces/IAutomate.sol:IAutomate", AUTOMATE_ADDRESS);
    taskTreasury = await ethers.getContractAt(
      "contracts/interfaces/ITaskTreasuryUpgradable.sol:ITaskTreasuryUpgradable",
      TASK_TREASURY_ADDRESS
    );

    await avatar.enableModule(gelatoSafeModule.address);

    const isModuleEnabled = await avatar.isModuleEnabled(gelatoSafeModule.address);
    console.log(" ")
    console.log("\x1b[32m%s\x1b[0m", "    ->", `\x1b[30mIs GelatoGnosisSafe Module enabled? ${isModuleEnabled}`);
    console.log(" ")
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [GELATO_ADDRESS],
    });
    executor = ethers.provider.getSigner(GELATO_ADDRESS);

    // Deposit ETH on Gelato to pay for transactions via Safe
    const depositAmount = ethers.utils.parseEther("100");
    await user.sendTransaction({ to: avatar.address, value: depositAmount });
    await user.sendTransaction({ to: GELATO_ADDRESS, value: depositAmount });

    const treasuryAmount = ethers.utils.parseEther("50");
    // Deposit funds into the Treasury
    await avatar.execTransaction(
      taskTreasury.address,
      treasuryAmount,
      taskTreasury.interface.encodeFunctionData("depositFunds", [avatar.address, ETH, treasuryAmount]),
      CALL
    );
  });

  it("It automates recurring payment to a contributor", async () => {
    const payment = ethers.utils.parseEther("1");

    let contributorBalance_0 = await hre.ethers.provider.getBalance(contributorAddress);

    ///
    const data = await avatar.interface.encodeFunctionData("execTransaction", [
      contributorAddress,
      payment,
      "0x",
      CALL,
    ]);

    const gelatoSafeModuleData = gelatoSafeModule.interface.encodeFunctionData("execute", [
      avatar.address,
      [
        {
          to: avatar.address,
          data: data,
          value: 0,
          operation: CALL,
        },
      ],
    ]);
    const startTime = (await getTimeStampNow()) + INTERVAL;

    const modules: Module[] = [Module.TIME, Module.PROXY];
    const timeArgs = encodeTimeArgs(startTime, INTERVAL);
    const proxyArgs = "0x";
    const moduleData = { modules, args: [timeArgs, proxyArgs] };

    //// CREATE THE TASK
    await avatar.execTransaction(
      automate.address,
      0,
      automate.interface.encodeFunctionData("createTask", [
        gelatoSafeModule.address,
        gelatoSafeModuleData,
        moduleData,
        ZERO_ADD,
      ]),
      CALL,
      { gasLimit: 2_000_000 }
    );

    console.log("\x1b[32m%s\x1b[0m", "    ->", `\x1b[30mFast forward time to next execution`);
    // fast forward time
    await fastForwardTime(INTERVAL);

    //// EXECUTION
    await automate
      .connect(executor)
      .exec(avatar.address, gelatoSafeModule.address, gelatoSafeModuleData, moduleData, FEE, ETH, true, true, {
        gasLimit: 1_000_000,
      });

    let contributorBalance_1 = await hre.ethers.provider.getBalance(contributorAddress);

    let diff = contributorBalance_1.sub(contributorBalance_0);

    console.log("\x1b[32m%s\x1b[0m", "    ✔", `\x1b[30mContributor balance increased in 1 ETH`);
    expect(diff).eq(payment);

    await expect(
      automate
        .connect(executor)
        .exec(avatar.address, gelatoSafeModule.address, gelatoSafeModuleData, moduleData, FEE, ETH, true, true, {
          gasLimit: 1_000_000,
        })
    ).to.be.revertedWith("Ops.preExecCall: TimeModule: Too early");
    console.log("\x1b[32m%s\x1b[0m", "    ✔", `\x1b[30mExecution reverted as expected before interval`);


    console.log("\x1b[32m%s\x1b[0m", "    ->", `\x1b[30mFast forward time to next execution`);
   
   // fast forward time
   await fastForwardTime(INTERVAL);

   //// EXECUTION
   await automate
     .connect(executor)
     .exec(avatar.address, gelatoSafeModule.address, gelatoSafeModuleData, moduleData, FEE, ETH, true, true, {
       gasLimit: 1_000_000,
     });

   let contributorBalance_2 = await hre.ethers.provider.getBalance(contributorAddress);

   let diff_2 = contributorBalance_2.sub(contributorBalance_0);

   console.log("\x1b[32m%s\x1b[0m", "    ✔", `\x1b[30mContributor balance increased in 2 ETH`);
   expect(diff_2).eq(payment.mul(2));



  });

  it("Automate execution at a specifific point of time ", async () => {
 
    console.log(" ")

    const execData = counter.interface.encodeFunctionData("increaseCount", [1]);

    const gelatoSafeModuleData = gelatoSafeModule.interface.encodeFunctionData("execute", [
      avatar.address,
      [
        {
          to: counter.address,
          data: execData,
          value: 0,
          operation: CALL,
        }
      ],
    ]);

    const delay = 6 * 60 * 60 * 1000 //// six hours
    const startTime = (await getTimeStampNow()) + delay;

    const modules: Module[] = [Module.TIME, Module.PROXY, Module.SINGLE_EXEC];
    const timeArgs = encodeTimeArgs(startTime, INTERVAL);
    const proxyArgs = "0x";
    const moduleData = { modules, args: [timeArgs, proxyArgs,"0x"] };

    await avatar.execTransaction(
      automate.address,
      0,
      automate.interface.encodeFunctionData("createTask", [
        gelatoSafeModule.address,
        gelatoSafeModuleData,
        moduleData,
        ZERO_ADD,
      ]),
      CALL,
      { gasLimit: 2_000_000 }
    );

    // fast forward time
    await fastForwardTime(delay);
    console.log("\x1b[32m%s\x1b[0m", "    ->", `\x1b[30mFast forward time to next execution`);

    await automate
      .connect(executor)
      .exec(avatar.address, gelatoSafeModule.address, gelatoSafeModuleData, moduleData, FEE, ETH, true, true, {
        gasLimit: 2_000_000,
      });
    

    const counterValue = await counter.count();
    expect(counterValue).eq(1);
    console.log("\x1b[32m%s\x1b[0m", "    ✔", `\x1b[30mCounter increased in 1`);


    await fastForwardTime(INTERVAL);

    await  expect (automate
      .connect(executor)
      .exec(avatar.address, gelatoSafeModule.address, gelatoSafeModuleData, moduleData, FEE, ETH, true, true, {
        gasLimit: 2_000_000,
      })).to.be.revertedWith('Ops.exec: Task not found')
    
      console.log("\x1b[32m%s\x1b[0m", "    ✔", `\x1b[30mExecution reverted as expected before interval`);

  });
});
