// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ContractArtifacts } from '@statechannels/nitro-protocol'
import { ethers } from 'hardhat'

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await run('compile');

  // NitroAdjudicator
  const NitroAdjudicator = await ethers.getContractFactory(
    ContractArtifacts.NitroAdjudicatorArtifact.abi,
    ContractArtifacts.NitroAdjudicatorArtifact.bytecode,
  )
  const nitroAdjudicator = await NitroAdjudicator.deploy()
  await nitroAdjudicator.deployed()
  console.log('NitroAdjudicator deployed to:', nitroAdjudicator.address)

  // TrivialApp
  const TrivialApp = await ethers.getContractFactory('TrivialApp')
  const trivialApp = await TrivialApp.deploy()
  await trivialApp.deployed()
  console.log('TrivialApp deployed to:', trivialApp.address)

  // SingleAssetPayments
  // const SingleAssetPayments = await ethers.getContractFactory(
  //   'SingleAssetPayments',
  // )
  // const singleAssetPayments = await SingleAssetPayments.deploy()
  // await singleAssetPayments.deployed()
  // console.log('SingleAssetPayments deployed to:', singleAssetPayments.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
