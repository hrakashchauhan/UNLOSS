import { expect, it } from 'vitest';
import { csvCell } from '../src/reporting.js';
import { reportMonthBounds } from '../src/rules.js';
it.each(['=1+1','+cmd','-cmd','@SUM(1)','  =HYPERLINK("bad")','\tvalue','\rvalue','\nvalue'])('neutralizes spreadsheet formula/control prefix %s', value => {
  expect(csvCell(value)).toBe(`"'${value.replaceAll('"','""')}"`);
});
it('quotes CSV commas, quotes and embedded newlines', () => expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"'));
it('handles leap year and year rollover with Kolkata boundaries', () => {
  expect(reportMonthBounds('2040-02').map(d => d.toISOString())).toEqual(['2040-01-31T18:30:00.000Z','2040-02-29T18:30:00.000Z']);
  expect(reportMonthBounds('2026-12')[1].toISOString()).toBe('2026-12-31T18:30:00.000Z');
  expect(() => reportMonthBounds('0000-01')).toThrow();
});
