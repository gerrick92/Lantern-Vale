# Original Softstack brief (unchanged content)

🪙 **Project:** Create Your Own Meme Coin Ecosystem
**Duration:** 10 Days
**Technologies:** Solidity, TypeScript, Next.js, Wagmi, OpenZeppelin
**Blockchain:** Ethereum Sepolia Testnet

**Project Goal**

Create your own meme token, build a website around it, and develop an interactive Web3 experience that allows users to connect their wallets and actually use the token.

The goal is not just to deploy another ERC-20 token, but to build a small ecosystem around it.

Each intern can choose their own meme, branding, token name, and functionality. Creativity is encouraged!

At the end of the project, everyone will present their token and demonstrate its functionality.

**1. Create Your Own Meme Token**

Develop and deploy a custom ERC-20 token using Solidity.

**Requirements**

1. Choose a unique meme theme for your token.
2. Create a token name and symbol.
3. Define a fixed maximum supply.
4. Implement the ERC-20 standard using OpenZeppelin.
5. Add a `mint()` function that only the contract owner can execute, respecting the maximum supply.
6. Add a `burn()` function that allows holders to destroy their own tokens.
7. Deploy the token to Ethereum Sepolia.
8. Verify the smart contract on Etherscan.

**Learning Goals:** Solidity, ERC-20, access control, smart contract deployment, contract verification.

🎮 **Build a Token-Based Gamification Feature**

**This is the main challenge!**

Every meme token must have at least **one interactive game or gamification feature** accessible through the website.

Users must be able to connect their wallets and use their meme tokens to participate.

The feature must interact with at least one smart contract. Simply displaying token balances or using JavaScript to simulate token transactions does not count.

**Example Ideas**

🪙 **Coin Flip**
**Description:** Flip a virtual coin using meme tokens
**Smart Contract Interaction:** Pay tokens to play, receive points or rewards

🎰 **Meme Slot Machine**
**Description:** A simple slot machine with meme-themed symbols
**Smart Contract Interaction:** Spend tokens to activate spins

🔥 **Burn Challenge**
**Description:** Burn tokens to climb a leaderboard
**Smart Contract Interaction:** Burn tokens through a dedicated contract

🐸 **Meme Battle**
**Description:** Battle another meme character
**Smart Contract Interaction:** Spend tokens to enter battles

🎯 **Daily Challenge**
**Description:** Complete a daily activity to earn rewards
**Smart Contract Interaction:** Claim tokens after completing a challenge

🏆 **Staking Challenge**
**Description:** Lock tokens to earn experience points
**Smart Contract Interaction:** Stake and unstake tokens

🎁 **Mystery Box**
**Description:** Spend tokens to open a virtual mystery box
**Smart Contract Interaction:** Transfer or burn tokens to open boxes

🗳️ **Meme Voting**
**Description:** Vote on the best memes using tokens
**Smart Contract Interaction:** Token-weighted voting

🐾 **Virtual Pet**
**Description:** Feed your meme pet with tokens
**Smart Contract Interaction:** Burn tokens to feed and level up your pet

🏎️ **Meme Racing**
**Description:** Race meme characters against each other
**Smart Contract Interaction:** Use tokens to enter races

**Important:** Keep all token activity on Sepolia with no real-money value. For random games, use a secure randomness mechanism where outcomes affect token rewards. Alternatively, keep rewards limited to off-chain points or achievements.

**Minimum Requirements**

1. Connect a wallet through the website.
2. Detect the user's meme token balance.
3. Allow users to interact with the game using their tokens.
4. Execute at least one smart contract transaction.
5. Display the transaction status.
6. Update the interface after the transaction is confirmed.
7. Prevent users from executing invalid actions, such as spending more tokens than they own.

🌐 **3. Create a Meme Token Landing Page**

Build a modern, responsive website using **Next.js and TypeScript**.

Be creative! The website should reflect the personality of your meme token.

**Required Sections**

🚀 **Hero Section**

- Token name and symbol
- Custom logo or mascot
- Short, funny description
- Call-to-action button
- Connect Wallet button

🪙 **Token Information**

- Total supply
- Token contract address
- Blockchain network
- Link to Etherscan
- Tokenomics overview

🎮 **Interactive Game**

- Your gamification feature
- Connected wallet information
- Current token balance
- Interactive game controls
- Transaction confirmation and status

👥 **Community Section**

- About the meme
- Roadmap (can be funny)

⚙️ **Technical Requirements**

1. Use Next.js with App Router.
2. Use TypeScript for all components.
3. Use Tailwind CSS for styling.
4. Integrate Wagmi and Viem for wallet interactions.
5. Support MetaMask or other compatible wallets.
6. Implement responsive layouts for desktop and mobile.
7. Handle wallet connection and transaction errors.
8. Display loading states during blockchain interactions.

🚰 **4. Implement a Token Faucet**

Every project should provide a way for other interns to obtain the meme token without needing to request tokens from the owner.

**Requirements**

1. Add a **Claim Tokens** button to the website.
2. Allow connected wallets to claim a fixed number of tokens.
3. Limit claims to once every 24 hours per wallet.
4. Display a countdown until the next claim.
5. Prevent claims when the faucet has insufficient tokens.
6. Show the claimed tokens in the user's wallet balance.

**Technical Challenge:**

Implement the faucet functionality in Solidity, either within the token contract or as a separate smart contract.

🧪 **5. Testing & Quality Assurance**

Each intern must test their contracts and application.

**Requirements**

**Smart Contract Tests**

- Test token minting.
- Test token burning.
- Test transfers.
- Test unauthorized function calls.
- Test the game's core functionality.
- Test edge cases.

Use Foundry for smart contract testing.

📂 **6. GitHub, Documentation & Deployment**

The final project must be available on GitHub.

**Requirements**

1. Create a GitHub repository.
2. Write a README with setup instructions.
3. Document the token's purpose and functionality.
4. Include the deployed smart contract addresses.
5. Provide instructions for obtaining Sepolia ETH.
6. Explain how the game works.
7. Deploy the Next.js frontend publicly.
8. Provide the live website URL / use Github pages or Vercel

🏆 **Final Presentation: Meme Coin Battle**

At the end of the internship challenge, everyone gets **10 minutes** to present their project.

**Presentation Requirements**

1. **The Meme:** Why did you choose this meme? What's the story?
2. **The Token:** Demonstrate the ERC-20 smart contract.
3. **The Website:** Show your Next.js landing page.
4. **The Game:** Connect a wallet and demonstrate a complete interaction.
5. **The Code:** Explain one interesting technical implementation.

**And most importantly: Everyone must be able to play everyone else's game at the end of the challenge!**
