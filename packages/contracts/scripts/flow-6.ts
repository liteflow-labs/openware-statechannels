//
// Flow 6
// 3 participants, 3 states.
// Each participant deposit 1 ETH
// Last state is the first participant get all the ETH
// All participants sign the last finale state
// The first participant get 3 ETH and the other nothing
//

import { hexZeroPad } from '@ethersproject/bytes'
import { AddressZero, HashZero } from '@ethersproject/constants'
import { formatUnits, parseUnits } from '@ethersproject/units'
import {
  Channel,
  ContractArtifacts,
  encodeOutcome,
  getChannelId,
  getFixedPart,
  hashAppPart,
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
  const signers = (await ethers.getSigners()).slice(-3)
  console.log('Participants', signers.map((s) => s.address).join(', '))

  // init channel
  const channelNonce = 0
  const chainId = (await ethers.provider.getNetwork()).chainId.toString()
  const channel: Channel = {
    chainId,
    channelNonce,
    participants: signers.map((s) => s.address),
  }
  const channelId = getChannelId(channel)

  // deposits
  const amount = parseUnits('1', 'ether')
  console.log('Depositing...')
  for (const signer of signers) {
    // must execute this one by one to get the up to date holdings
    await assertBalance(signer.address, '10000')
    const expectedHeld = await nitroAdjudicator.holdings(AddressZero, channelId)
    const tx = await nitroAdjudicator
      .connect(signer)
      .deposit(MAGIC_ADDRESS_INDICATING_ETH, channelId, expectedHeld, amount, {
        value: amount,
      })
    await tx.wait()
    await assertBalance(signer.address, '99989')
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
            destination: hexZeroPad(signers[0].address, 32),
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
      signers.map((s) => signStateWithSigner(state, s)),
    )
    const numStates = 1
    const fixedPart = getFixedPart(state)
    const appPartHash = hashAppPart(state)
    const outcomeBytes = encodeOutcome(state.outcome)
    const tx = await nitroAdjudicator
      .connect(signers[2]) // can be call by anyone
      .concludeAndTransferAllAssets(
        largestTurnNum,
        fixedPart,
        appPartHash,
        outcomeBytes,
        numStates,
        whoSignedWhat,
        signatures,
      )
    await tx.wait()
  })()

  console.log('Waiting 5sec for the channel to finalized')
  await wait(5000)

  await (async () => {
    const expectedHeld = await nitroAdjudicator.holdings(AddressZero, channelId)
    console.log(`Channel holds: ${formatUnits(expectedHeld, 'ether')} ETH`)
    if (!expectedHeld.eq(0)) throw new Error('incorrect holding on channel')
  })()

  await assertBalance(signers[0].address, '10001')

  await assertChannelMode(nitroAdjudicator, channel, 'Finalized')
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    throw error
  })
