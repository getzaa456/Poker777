const suits = ['H', 'D', 'C', 'S'];
const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export function createShuffledDeck() {
    const deck = [];
    for (const s of suits) {
        for (const v of values) deck.push(v + s);
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export function parseCard(cardStr) {
    if (!cardStr || cardStr.length < 2) return null;
    return {
        rank: cardStr.slice(0, -1).toUpperCase(),
        suit: cardStr.slice(-1).toUpperCase(),
    };
}



const RANK_ORDER = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

// คำนวณความใหญ่ของชุดไพ่ (Hand Evaluator)
export function handScore(cards) {
    if (!cards || cards.length < 5) return { category: 0, ranks: [] };

    const parsed = cards.map(parseCard).filter(Boolean);

    // สร้าง Combination 5 ใบจากไพ่ที่มีทั้งหมด (5-7 ใบ)
    const getCombinations = (arr, k) => {
        if (k === 0) return [[]];
        if (arr.length === 0) return [];
        const head = arr[0];
        const tail = arr.slice(1);
        const withHead = getCombinations(tail, k - 1).map(c => [head, ...c]);
        const withoutHead = getCombinations(tail, k);
        return [...withHead, ...withoutHead];
    };

    const combo5List = getCombinations(parsed, 5);
    let bestScore = null;

    for (const combo of combo5List) {
        const score = evaluate5CardHand(combo);
        if (!bestScore || compareScores(score, bestScore) > 0) {
            bestScore = score;
        }
    }

    return bestScore || { category: 0, ranks: [] };
}

// Helper คำนวณแต้มเฉพาะไพ่ 5 ใบ
function evaluate5CardHand(cards5) {
    const ranks = cards5.map(c => RANK_ORDER[c.rank]).sort((a, b) => b - a);
    const suitsMap = cards5.reduce((acc, c) => {
        acc[c.suit] = (acc[c.suit] || 0) + 1;
        return acc;
    }, {});

    const isFlush = Object.values(suitsMap).some(count => count === 5);

    // ตรวจสอบ Straight
    let isStraight = false;
    let straightHigh = 0;

    // กรณีพิเศษ A-2-3-4-5 (Ace Low)
    const uniqueRanks = [...new Set(ranks)];
    if (uniqueRanks.length === 5) {
        if (ranks[0] - ranks[4] === 4) {
            isStraight = true;
            straightHigh = ranks[0];
        } else if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
            isStraight = true;
            straightHigh = 5; // ไพ่ใหญ่สุดของชุดนี้คือ 5
        }
    }

    // นับจำนวนไพ่ที่ซ้ำกัน
    const counts = {};
    ranks.forEach(r => { counts[r] = (counts[r] || 0) + 1; });

    const countGroups = Object.entries(counts)
        .map(([rank, count]) => ({ rank: Number(rank), count }))
        .sort((a, b) => b.count - a.count || b.rank - a.rank);

    // 8: Straight Flush
    if (isStraight && isFlush) return { category: 8, ranks: [straightHigh] };

    // 7: Four of a Kind
    if (countGroups[0].count === 4) {
        return { category: 7, ranks: [countGroups[0].rank, countGroups[1].rank] };
    }

    // 6: Full House
    if (countGroups[0].count === 3 && countGroups[1].count === 2) {
        return { category: 6, ranks: [countGroups[0].rank, countGroups[1].rank] };
    }

    // 5: Flush
    if (isFlush) return { category: 5, ranks };

    // 4: Straight
    if (isStraight) return { category: 4, ranks: [straightHigh] };

    // 3: Three of a Kind
    if (countGroups[0].count === 3) {
        return { category: 3, ranks: [countGroups[0].rank, countGroups[1].rank, countGroups[2].rank] };
    }

    // 2: Two Pair
    if (countGroups[0].count === 2 && countGroups[1].count === 2) {
        return { category: 2, ranks: [countGroups[0].rank, countGroups[1].rank, countGroups[2].rank] };
    }

    // 1: One Pair
    if (countGroups[0].count === 2) {
        return { category: 1, ranks: [countGroups[0].rank, countGroups[1].rank, countGroups[2].rank, countGroups[3].rank] };
    }

    // 0: High Card
    return { category: 0, ranks };
}

// เปรียบเทียบความใหญ่ของไพ่สองชุด
export function compareScores(left, right) {
    if (!left || !right) return 0;
    if (left.category !== right.category) {
        return left.category - right.category;
    }
    for (let i = 0; i < Math.max(left.ranks.length, right.ranks.length); i++) {
        const l = left.ranks[i] || 0;
        const r = right.ranks[i] || 0;
        if (l !== r) return l - r;
    }
    return 0;
}

// แปลง Category เป็นชื่อเรียกภาษาอังกฤษ
export function handName(category) {
  const names = [
    'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
    'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'
  ];
  return names[category] || 'Unknown';
}