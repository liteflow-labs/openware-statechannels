//
// Flow 6.1-bis
// Same as 6.1 but with 2 transactions: conclude and then transferAllAssets and transaction are signed by different signers that don't participate in the state channel
//

import { hexZeroPad } from '@ethersproject/bytes'
import { AddressZero, HashZero } from '@ethersproject/constants'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { Wallet } from '@ethersproject/wallet'
import {
  Channel,
  ContractArtifacts,
  encodeOutcome,
  getChannelId,
  getFixedPart,
  hashAppPart,
  hashOutcome,
  State,
} from '@statechannels/nitro-protocol'
import { MAGIC_ADDRESS_INDICATING_ETH } from '@statechannels/nitro-protocol/lib/src/transactions'
import { ethers } from 'hardhat'
import { NitroAdjudicator } from '../types'
import { assertBalance, assertChannelMode } from './assert'
import { signStateWithSigner, wait } from './utils'

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

  // TrivialApp
  const TrivialApp = await ethers.getContractFactory('TrivialApp')
  const trivialApp = await TrivialApp.deploy()
  await trivialApp.deployed()

  // participants
  const allSigners = await ethers.getSigners()
  const signers = allSigners.slice(-3)
  const ephemeralKeys = signers.map(() => Wallet.createRandom())
  console.log('Participants', signers.map((s) => s.address).join(', '))
  console.log('Ephemeral keys', ephemeralKeys.map((s) => s.address).join(', '))

  // init channel
  const channelNonce = 0
  const chainId = (await ethers.provider.getNetwork()).chainId.toString()
  const channel: Channel = {
    chainId,
    channelNonce,
    participants: ephemeralKeys.map((s) => s.address),
  }
  const channelId = getChannelId(channel)

  // deposits
  const amount = parseUnits('1', 'ether')
  console.log('Depositing...')
  for (const _ of signers) {
    // must execute this one by one to get the up to date holdings
    const expectedHeld = await nitroAdjudicator.holdings(AddressZero, channelId)
    const tx = await nitroAdjudicator
      .connect(allSigners[1]) // can be call by anyone
      .deposit(MAGIC_ADDRESS_INDICATING_ETH, channelId, expectedHeld, amount, {
        value: amount,
      })
    await tx.wait()
  }

  await (async () => {
    const expectedHeld = await nitroAdjudicator.holdings(AddressZero, channelId)
    console.log(`Channel holds: ${formatUnits(expectedHeld, 'ether')} ETH`)
    if (!expectedHeld.eq(amount.mul(signers.length)))
      throw new Error('incorrect holding on channel')
  })()

  // Construct a final state
  const largestTurnNum = 4
  const state: State = {
    isFinal: true,
    channel,
    outcome: [
      {
        asset: MAGIC_ADDRESS_INDICATING_ETH,
        allocationItems: [
          {
            amount: amount.mul(signers.length).toString(),
            destination: hexZeroPad(allSigners[2].address, 32), // can be call by anyone
          },
        ],
      },
    ],
    appDefinition: trivialApp.address,
    appData: HashZero,
    challengeDuration: 1,
    turnNum: largestTurnNum,
  }

  await (async () => {
    console.log('Concluding...')
    const whoSignedWhat = [0, 0, 0]
    const signatures = await Promise.all(
      ephemeralKeys.map((s) => signStateWithSigner(state, s)),
    )
    const numStates = 1
    const fixedPart = getFixedPart(state)
    const appPartHash = hashAppPart(state)
    const outcomeHash = hashOutcome(state.outcome)
    const tx = await nitroAdjudicator
      .connect(allSigners[3]) // can be call by anyone
      .conclude(
        largestTurnNum,
        fixedPart,
        appPartHash,
        outcomeHash,
        numStates,
        whoSignedWhat,
        signatures,
      )
    await tx.wait()
  })()

  console.log('Waiting 5sec for the channel to finalized')
  await wait(5000)

  await (async () => {
    console.log('Transferring...')
    const stateHash = HashZero // if the channel was concluded on the happy path, we can use this default value
    const outcomeBytes = encodeOutcome(state.outcome)
    const tx = await nitroAdjudicator
      .connect(allSigners[4]) // can be call by anyone
      .transferAllAssets(channelId, outcomeBytes, stateHash)
    await tx.wait()
  })()

  await (async () => {
    const expectedHeld = await nitroAdjudicator.holdings(AddressZero, channelId)
    console.log(`Channel holds: ${formatUnits(expectedHeld, 'ether')} ETH`)
    if (!expectedHeld.eq(0)) throw new Error('incorrect holding on channel')
  })()

  await assertBalance(allSigners[2].address, '10003', true)

  await assertChannelMode(nitroAdjudicator, channel, 'Finalized')
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    throw error
  })
