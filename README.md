## Run the flows

Check the folder `packages/contracts/scripts` to see the all the flows to execute.

Each flow has a description at the top of the file.

To execute a flow, run:

```
npm run -w packages/contracts hardhat -- run ./scripts/flow-1.ts
```

## Run the UI locally

### Start local Ethereum node

```bash
npm run -w packages/contracts hardhat -- node
```

### Deploy smart contracts

```bash
npm run -w packages/contracts hardhat -- run ./scripts/deploy.ts --network localhost
```

### Run UI

```bash
npm run -w packages/ui dev
```
