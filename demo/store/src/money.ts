/** Money is kept in integer cents internally and sent as "29.00" strings (the contract's Money). */
export const toMoney = (cents: number) => (cents / 100).toFixed(2);
export const toCents = (money: string) => Math.round(Number(money) * 100);
