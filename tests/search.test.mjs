import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSearchMode, normalizeForCompare, buildSearchTokens, entryMatchesSearch} from '../search.js';

const entry = {
  sku: 'LED-AB123', productName: '測試崁燈', searchAliases: ['OLD'],
  searchText: normalizeForCompare('LED-AB123 測試崁燈 贈品 987 654 543 432 特殊備註 額外資訊'),
};
const matches = (query, mode) => entryMatchesSearch(entry, normalizeForCompare(query), buildSearchTokens(query), mode);

test('existing users and invalid saved settings default to all fields', () => {
  for (const value of [null, undefined, '', 'all', 'invalid', {}, 1]) assert.equal(normalizeSearchMode(value), 'all');
  assert.equal(normalizeSearchMode('identity'), 'identity');
});

test('both scopes preserve model/name, case, punctuation and multi-token matching', () => {
  for (const mode of ['all', 'identity']) {
    for (const query of ['', 'led ab123', 'AB-123', '崁燈', '崁燈 LED', 'LED / 測試']) {
      assert.equal(matches(query, mode), true, `${mode}: ${query}`);
    }
    assert.equal(matches('LED 不存在', mode), false);
    assert.equal(matches('73.21', mode), false, 'cost must not enter either index');
  }
});

test('identity mode excludes prices, notes, bonus, extras and non-identity aliases in every token', () => {
  for (const query of ['987', '654', '543', '432', '特殊備註', '贈品', '額外資訊', 'OLD', 'LED 備註', '崁燈 987']) {
    assert.equal(matches(query, 'all'), true, query);
    assert.equal(matches(query, 'identity'), false, query);
  }
});
