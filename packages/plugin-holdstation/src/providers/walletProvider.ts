import {
    Provider,
    IAgentRuntime,
    Memory,
    State,
    elizaLogger,
} from "@elizaos/core";

import {
    Address,
    createPublicClient,
    erc20Abi,
    PublicClient,
    http,
    WalletClient,
    HttpTransport,
    Account,
    Chain,
    SendTransactionParameters,
} from "viem";
import { zksync } from "viem/chains";
import { PrivateKeyAccount } from "viem/accounts";

import { useGetAccount, useGetWalletClient } from "../hooks";
import { Item, SendTransactionParams, WalletPortfolio } from "../types";

// Add this simple cache class
class SimpleCache {
    private cache: Map<string, { value: any; expiry: number }>;
    private defaultTTL: number;

    constructor(defaultTTL: number = 300) { // 300 seconds = 5 minutes
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
    }

    set(key: string, value: any): void {
        this.cache.set(key, {
            value,
            expiry: Date.now() + (this.defaultTTL * 1000)
        });
    }

    get<T>(key: string): T | undefined {
        const item = this.cache.get(key);
        if (!item) return undefined;

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return undefined;
        }

        return item.value as T;
    }
}

export class WalletProvider {
    private cache: SimpleCache;
    account: PrivateKeyAccount;
    walletClient: WalletClient;
    publicClient: PublicClient<HttpTransport, Chain, Account | undefined>;

    constructor(account: PrivateKeyAccount) {
        this.account = account;
        this.walletClient = useGetWalletClient();
        this.publicClient = createPublicClient<HttpTransport>({
            chain: zksync,
            transport: http(),
        }) as PublicClient<HttpTransport, Chain, Account | undefined>;
        this.cache = new SimpleCache(300); // 5 minutes TTL
    }

    getAddress() {
        return this.account.address;
    }

    getPublicClient() {
        return this.publicClient;
    }

    async getAllowace(
        tokenAddress: Address,
        owner: Address,
        spender: Address,
    ): Promise<any> {
        return this.publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "allowance",
            args: [owner, spender],
        });
    }

    async approve(
        spenderAddress: Address,
        tokenAddress: Address,
        amount: bigint,
    ) {
        const result = await this.walletClient.writeContract({
            account: this.account,
            address: tokenAddress,
            abi: erc20Abi,
            chain: zksync,
            functionName: "approve",
            args: [spenderAddress, amount],
        });
    }

    async sendTransaction(req: SendTransactionParams): Promise<any> {
        const txRequest: SendTransactionParameters = {
            ...req,
            account: this.account,
            chain: zksync,
            kzg: undefined,
        };
        const tx = await this.walletClient.sendTransaction(txRequest);
        console.log("sendTransaction txhash:", tx);
        return tx;
    }

    async fetchPortfolio(): Promise<WalletPortfolio> {
        try {
            const cacheKey = `portfolio-${this.getAddress()}`;
            const cachedValue = this.cache.get<WalletPortfolio>(cacheKey);
            if (cachedValue) {
                elizaLogger.info("Cache hit for fetchPortfolio");
                return cachedValue;
            }
            elizaLogger.info("Cache miss for fetchPortfolio");

            const fetchUrl = `https://api.holdstation.com/api/user-balance/chain/324/wallet/${this.getAddress()}`;

            const portfolioResp = await fetch(fetchUrl);
            const portfolioData = await portfolioResp.json();
            if (!portfolioData || !portfolioData.success) {
                elizaLogger.error("Failed to fetch portfolio:", portfolioData);
                throw new Error(
                    `Failed to fetch portfolio: ${
                        portfolioData?.error || "Unknown error"
                    }`,
                );
            }

            const items: Array<Item> =
                portfolioData.data.map(
                    (item: any): Item => ({
                        name: item.contract_name,
                        address: item.contract_address,
                        symbol: item.contract_ticker_symbol,
                        decimals: item.contract_decimals,
                    }),
                ) || [];
            const portfolio: WalletPortfolio = { items };

            this.cache.set(cacheKey, portfolio);
            return portfolio;
        } catch (error) {
            elizaLogger.error("Error fetching portfolio:", error);
            throw error;
        }
    }

    async fetchAllTokens(): Promise<Array<Item>> {
        try {
            const cacheKey = `all-hswallet-tokens`;
            const cachedValue = this.cache.get<Array<Item>>(cacheKey);
            if (cachedValue) {
                elizaLogger.log("Cache hit for fetch all");
                return cachedValue;
            }
            elizaLogger.log("Cache miss for fetch all");

            const fetchUrl = `https://tokens.coingecko.com/zksync/all.json`;

            const tokensResp = await fetch(fetchUrl);
            const tokensData = await tokensResp.json();
            if (!tokensData || tokensData.error || !tokensData.data) {
                elizaLogger.error("Failed to fetch all tokens:", tokensData);
                throw new Error(
                    `Failed to fetch all tokens: ${
                        tokensData?.error || "Unknown error"
                    }`,
                );
            }

            const tokens: Array<Item> =
                tokensData.tokens.map(
                    (item: any): Item => ({
                        name: item.name,
                        address: item.address,
                        symbol: item.symbol,
                        decimals: item.decimals,
                    }),
                ) || [];

            this.cache.set(cacheKey, tokens);
            return tokens;
        } catch (error) {
            elizaLogger.error("Error fetching all tokens:", error);
            throw error;
        }
    }
}

export const initWalletProvider = async (runtime: IAgentRuntime) => {
    const account = useGetAccount(runtime);

    return new WalletProvider(account);
};

export const holdstationWalletProvider: Provider = {
    get: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
    ): Promise<any> => {
        try {
            const walletProvider = await initWalletProvider(runtime);
            const agentName = state.agentName || "The agent";
            return `${agentName}'s HoldStation Wallet address: ${walletProvider.getAddress()}`;
        } catch (error) {
            console.error("Error in HoldStation Wallet provider:", error);
            return null;
        }
    },
};
