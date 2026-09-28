import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSidePots,
  createShuffledDeck,
  distributeSidePots,
  isBettingRoundComplete,
  selectBlindPositions,
} from '../services/game.js';

test('createShuffledDeck returns all 52 unique cards', () => {
  const deck = createShuffledDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
});

test('selectBlindPositions rotates the button and uses the button as heads-up small blind', () => {
  const seats = [['seat_0', 'one'], ['seat_2', 'two'], ['seat_4', 'three']];
  assert.deepEqual(selectBlindPositions(seats, null), {
    dealerSeat: 0,
    dealerId: 'one',
    smallBlindSeat: 2,
    smallBlindId: 'two',
    bigBlindSeat: 4,
    bigBlindId: 'three',
  });
  assert.deepEqual(selectBlindPositions(seats, 2), {
    dealerSeat: 4,
    dealerId: 'three',
    smallBlindSeat: 0,
    smallBlindId: 'one',
    bigBlindSeat: 2,
    bigBlindId: 'two',
  });
  assert.deepEqual(selectBlindPositions(seats.slice(0, 2), 0), {
    dealerSeat: 2,
    dealerId: 'two',
    smallBlindSeat: 2,
    smallBlindId: 'two',
    bigBlindSeat: 0,
    bigBlindId: 'one',
  });
});

test('buildSidePots creates main and side pots from unequal all-in contributions', () => {
  assert.deepEqual(
    buildSidePots({ short: 50, deepA: 100, deepB: 100 }, ['short', 'deepA', 'deepB']),
    [
      { amount: 150, eligiblePlayerIds: ['short', 'deepA', 'deepB'] },
      { amount: 100, eligiblePlayerIds: ['deepA', 'deepB'] },
    ],
  );
});

test('distributeSidePots awards the main pot and side pot to their eligible winners', () => {
  const players = [
    { clientId: 'short', holeCards: ['KS', 'QS'] },
    { clientId: 'deepA', holeCards: ['AH', 'AD'] },
    { clientId: 'deepB', holeCards: ['2H', '2S'] },
  ];
  const communityCards = ['KH', 'KD', 'KC', '2D', '3S'];

  assert.deepEqual(
    distributeSidePots(
      players,
      { short: 50, deepA: 100, deepB: 100 },
      communityCards,
    ),
    {
      pots: [
        { amount: 150, eligiblePlayerIds: ['short', 'deepA', 'deepB'], winnerIds: ['short'] },
        { amount: 100, eligiblePlayerIds: ['deepA', 'deepB'], winnerIds: ['deepA'] },
      ],
      payouts: { short: 150, deepA: 100, deepB: 0 },
    },
  );
});

test('folded players contribute to pots but cannot win; tied odd chips go in stable order', () => {
  const players = [
    { clientId: 'first', holeCards: ['2H', '3H'] },
    { clientId: 'second', holeCards: ['4H', '5H'] },
    { clientId: 'folded', holeCards: ['6H', '7H'], isFolded: true },
  ];
  const result = distributeSidePots(
    players,
    { first: 1, second: 1, folded: 1 },
    ['AS', 'KS', 'QS', 'JS', 'TS'],
  );

  assert.deepEqual(result.pots[0], {
    amount: 3,
    eligiblePlayerIds: ['first', 'second'],
    winnerIds: ['first', 'second'],
  });
  assert.deepEqual(result.payouts, { first: 2, second: 1, folded: 0 });
});

test('an all-in raise does not run out the board before the remaining player calls', () => {
  const remainingPlayer = [{ clientId: 'caller', chips: 900 }];

  assert.equal(isBettingRoundComplete(remainingPlayer, ['raiser'], 100, { caller: 20 }), false);
  assert.equal(isBettingRoundComplete(remainingPlayer, [], 100, { caller: 100 }), false);
  assert.equal(isBettingRoundComplete(remainingPlayer, ['caller'], 100, { caller: 100 }), true);
});