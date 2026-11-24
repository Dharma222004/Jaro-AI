export interface FinancialQuote {
  id: number;
  text: string;
  author?: string;
  category?: string;
}

export const FINANCIAL_QUOTES: FinancialQuote[] = [
  // ── Warren Buffett & Foundational Wisdom ──────────────────────────────
  {
    id: 1,
    text: "Be fearful when others are greedy, and greedy when others are fearful.",
    author: "Warren Buffett",
    category: "Mindset",
  },
  {
    id: 2,
    text: "The stock market is a device for transferring money from the impatient to the patient.",
    author: "Warren Buffett",
    category: "Patience",
  },
  {
    id: 3,
    text: "Risk comes from not knowing what you're doing.",
    author: "Warren Buffett",
    category: "Risk",
  },
  {
    id: 4,
    text: "Someone is sitting in the shade today because someone planted a tree a long time ago.",
    author: "Warren Buffett",
    category: "Long Term",
  },
  {
    id: 5,
    text: "Rule No. 1: Never lose money. Rule No. 2: Never forget Rule No. 1.",
    author: "Warren Buffett",
    category: "Capital Preservation",
  },
  {
    id: 6,
    text: "The best time to plant a tree was 20 years ago. The second best time is now.",
    author: "Chinese Proverb",
    category: "Action",
  },
  {
    id: 7,
    text: "Time in the market beats timing the market.",
    author: "Popular investing saying",
    category: "Compounding",
  },
  {
    id: 8,
    text: "Compound interest is the eighth wonder of the world.",
    author: "Attributed to Albert Einstein",
    category: "Compounding",
  },
  {
    id: 9,
    text: "The big money is not in the buying or selling, but in the waiting.",
    author: "Charlie Munger",
    category: "Patience",
  },
  {
    id: 10,
    text: "Patience is the investor's greatest asset.",
    category: "Patience",
  },

  // ── Learning & Knowledge ─────────────────────────────────────────────
  {
    id: 11,
    text: "An investment in knowledge pays the best interest.",
    author: "Benjamin Franklin",
    category: "Knowledge",
  },
  {
    id: 12,
    text: "Know what you own, and know why you own it.",
    author: "Peter Lynch",
    category: "Research",
  },
  {
    id: 13,
    text: "Invest in what you understand.",
    category: "Clarity",
  },
  {
    id: 14,
    text: "The four most dangerous words in investing are: 'This time it's different.'",
    author: "Sir John Templeton",
    category: "Market Cycles",
  },
  {
    id: 15,
    text: "In investing, what is comfortable is rarely profitable.",
    author: "Robert Arnott",
    category: "Contrarian",
  },
  {
    id: 16,
    text: "The investor's chief problem, and even his worst enemy, is likely to be himself.",
    author: "Benjamin Graham",
    category: "Psychology",
  },
  {
    id: 17,
    text: "Do your own research before you trust anyone's tip.",
    category: "Due Diligence",
  },
  {
    id: 18,
    text: "Learn to earn before you learn to burn.",
    category: "Discipline",
  },
  {
    id: 19,
    text: "Wealth is built by habits, not by luck.",
    category: "Habits",
  },
  {
    id: 20,
    text: "Education is the best investment you will ever make.",
    category: "Knowledge",
  },

  // ── Risk & Diversification ───────────────────────────────────────────
  {
    id: 21,
    text: "Don't put all your eggs in one basket.",
    author: "Old proverb",
    category: "Diversification",
  },
  {
    id: 22,
    text: "Diversification is the only free lunch in investing.",
    author: "Harry Markowitz",
    category: "Portfolio Construction",
  },
  {
    id: 23,
    text: "Risk is what's left when you think you've thought of everything.",
    author: "Carl Richards",
    category: "Risk",
  },
  {
    id: 24,
    text: "The stock market is filled with individuals who know the price of everything, but the value of nothing.",
    author: "Philip Fisher",
    category: "Valuation",
  },
  {
    id: 25,
    text: "Price is what you pay. Value is what you get.",
    author: "Warren Buffett",
    category: "Valuation",
  },
  {
    id: 26,
    text: "Markets can remain irrational longer than you can remain solvent.",
    author: "John Maynard Keynes",
    category: "Risk Management",
  },
  {
    id: 27,
    text: "It's not whether you're right or wrong, but how much money you make when you're right and how much you lose when you're wrong.",
    author: "George Soros",
    category: "Asymmetry",
  },
  {
    id: 28,
    text: "The goal of a successful trader is to make the best trades. Money is secondary.",
    author: "Alexander Elder",
    category: "Execution",
  },
  {
    id: 29,
    text: "Protect your capital first, grow it second.",
    category: "Capital Preservation",
  },
  {
    id: 30,
    text: "A small loss today is better than a big loss tomorrow.",
    category: "Risk Management",
  },

  // ── Money & Mindset ──────────────────────────────────────────────────
  {
    id: 31,
    text: "Do not save what is left after spending; spend what is left after saving.",
    author: "Warren Buffett",
    category: "Savings",
  },
  {
    id: 32,
    text: "Beware of little expenses; a small leak will sink a great ship.",
    author: "Benjamin Franklin",
    category: "Frugality",
  },
  {
    id: 33,
    text: "Rich people have small TVs and big libraries. Poor people have small libraries and big TVs.",
    author: "Zig Ziglar",
    category: "Mindset",
  },
  {
    id: 34,
    text: "Money is a terrible master but an excellent servant.",
    author: "P.T. Barnum",
    category: "Wealth",
  },
  {
    id: 35,
    text: "It's not how much money you make, but how much money you keep.",
    author: "Robert Kiyosaki",
    category: "Retention",
  },
  {
    id: 36,
    text: "Formal education will make you a living; self-education will make you a fortune.",
    author: "Jim Rohn",
    category: "Self Growth",
  },
  {
    id: 37,
    text: "Don't work for money; make money work for you.",
    category: "Financial Freedom",
  },
  {
    id: 38,
    text: "Financial freedom is available to those who learn about it and work for it.",
    author: "Robert Kiyosaki",
    category: "Independence",
  },
  {
    id: 39,
    text: "Wealth consists not in having great possessions, but in having few wants.",
    author: "Epictetus",
    category: "Contentment",
  },
  {
    id: 40,
    text: "The habit of saving is itself an education.",
    author: "T.T. Munger",
    category: "Savings",
  },

  // ── Market Wisdom ────────────────────────────────────────────────────
  {
    id: 41,
    text: "The stock market is a voting machine in the short run, but a weighing machine in the long run.",
    author: "Benjamin Graham",
    category: "Market Structure",
  },
  {
    id: 42,
    text: "Bulls make money, bears make money, but pigs get slaughtered.",
    author: "Wall Street saying",
    category: "Discipline",
  },
  {
    id: 43,
    text: "Buy the rumor, sell the news.",
    author: "Wall Street saying",
    category: "Market Dynamic",
  },
  {
    id: 44,
    text: "The trend is your friend.",
    author: "Wall Street saying",
    category: "Momentum",
  },
  {
    id: 45,
    text: "Far more money has been lost by investors preparing for corrections than in the corrections themselves.",
    author: "Peter Lynch",
    category: "Long Term",
  },
  {
    id: 46,
    text: "Never invest in a business you cannot understand.",
    author: "Warren Buffett",
    category: "Circle of Competence",
  },
  {
    id: 47,
    text: "The individual investor should act consistently as an investor and not as a speculator.",
    author: "Benjamin Graham",
    category: "Investing",
  },
  {
    id: 48,
    text: "Courage is not the absence of fear in the market, but acting wisely despite it.",
    category: "Psychology",
  },
  {
    id: 49,
    text: "Start small, stay consistent, think long term.",
    category: "Consistency",
  },
  {
    id: 50,
    text: "Your future self will thank you for the money you invest today.",
    category: "Future Wealth",
  },
];
