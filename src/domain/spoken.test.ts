/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialState, reducer } from './reducer';
import { splitSpoken } from './spoken';

test('a run-on brain dump becomes separate tasks', () => {
  assert.deepEqual(
    splitSpoken('um I need to call mom and then fix the computer oh and taxes'),
    ['Call mom', 'Fix the computer', 'Taxes'],
  );
});

test('a bare "and" stays inside one task', () => {
  assert.deepEqual(splitSpoken('buy salt and pepper'), ['Buy salt and pepper']);
});

test('a new "I have to" starts a new task, even without a joining word', () => {
  assert.deepEqual(
    splitSpoken('I have to email the landlord I should renew my passport and I gotta do laundry'),
    ['Email the landlord', 'Renew my passport', 'Do laundry'],
  );
});

test('punctuation, when the recognizer adds it, also splits', () => {
  assert.deepEqual(splitSpoken('Call the dentist. Text Sam back? Also, groceries.'), ['Call the dentist', 'Text Sam back', 'Groceries']);
});

test('fillers, repeats and noise are dropped', () => {
  assert.deepEqual(splitSpoken('so uh okay call mom and then yeah and then call mom'), ['Call mom']);
  assert.deepEqual(splitSpoken('um uh'), []);
  assert.deepEqual(splitSpoken(''), []);
});

test("curly apostrophes from the recognizer still count", () => {
  assert.deepEqual(splitSpoken('don’t forget to water the plants'), ['Water the plants']);
});

test('a voice capture is remembered as voice', () => {
  const s = reducer(initialState, { type: 'capture', at: '2026-10-07T09:00:00Z', id: 't0', title: 'Call mom', via: 'voice' });
  assert.deepEqual(s.events.at(-1)?.meta, { via: 'voice' });
});
