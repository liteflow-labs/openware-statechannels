//
// Flow 1
// All participants sign the last finale state
//

import { AddressZero, HashZero } from '@ethersproject/constants'
import { Wallet } from '@ethersproject/wallet'
import {
  Channel,
  ContractArtifacts,
  getFixedPart,
  hashAppPart,
  hashOutcome,
  signStates,
  State,
} from '@statechannels/nitro-protocol'
import { ethers } from 'hardhat'
import { NitroAdjudicator } from '../types'

const wallets = [
  Wallet.fromMnemonic(
    'test test test test test test test test test test test junk',
    "m/44'/60'/0'/0/19",
  ),
  Wallet.fromMnemonic(
    'test test test test test test test test test test test junk',
    "m/44'/60'/0'/0/18",
  ),
  Wallet.fromMnemonic(
    'test test test test test test test test test test test junk',
    "m/44'/60'/0'/0/17",
  ),
]
const participants = wallets.map((wallet) => wallet.address)
console.log('Participants', participants.join(', '))

async function main() {
  // Deploying smart contract
  console.log('Deploying smart contracts...')

  // NitroAdjudicator
  const NitroAdjudicator = await ethers.getContractFactory(
    ContractArtifacts.NitroAdjudicatorArtifact.abi,
    ContractArtifacts.NitroAdjudicatorArtifact.bytecode,
  )
  const nitroAdjudicator = (await NitroAdjudicator.deploy()) as NitroAdjudicator
  await nitroAdjudicator.deployed()

  // Construct a final state
  const chainId = (await ethers.provider.getNetwork()).chainId.toString()
  const channelNonce = 0
  const channel: Channel = { chainId, channelNonce, participants }
  const largestTurnNum = 4
  const state: State = {
    isFinal: true,
    channel,
    outcome: [],
    appDefinition: AddressZero,
    appData: HashZero,
    challengeDuration: 86400, // 1 day
    turnNum: largestTurnNum,
  }

  // Generate a finalization proof
  console.log('Signing...')
  const whoSignedWhat = [0, 0, 0]
  const signatures = await signStates([state], wallets, whoSignedWhat)

  // Call conclude
  console.log('Concluding...')
  const numStates = 1
  const fixedPart = getFixedPart(state)
  const appPartHash = hashAppPart(state)
  const outcomeHash = hashOutcome(state.outcome)
  const tx = await nitroAdjudicator.conclude(
    largestTurnNum,
    fixedPart,
    appPartHash,
    outcomeHash,
    numStates,
    whoSignedWhat,
    signatures,
  )
  await tx.wait()
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    throw error
  })