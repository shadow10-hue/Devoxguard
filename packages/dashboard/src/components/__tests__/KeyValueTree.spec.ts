import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import KeyValueTree from '../KeyValueTree.vue';

function buildDeeplyNested(levels: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf: 'bottom' };
  for (let i = 0; i < levels; i += 1) {
    node = { a: node };
  }
  return node;
}

describe('KeyValueTree', () => {
  it('renders flat scalar values with humanized labels', () => {
    const wrapper = mount(KeyValueTree, { props: { data: { originIp: '10.0.0.1' } } });
    expect(wrapper.text()).toContain('Origin Ip');
    expect(wrapper.text()).toContain('10.0.0.1');
  });

  it('recurses into nested objects up to a bounded depth', () => {
    const wrapper = mount(KeyValueTree, { props: { data: { a: { b: { c: 'value' } } } } });
    expect(wrapper.text()).toContain('value');
  });

  it('caps recursion depth instead of rendering an attacker-controlled deeply nested object indefinitely', () => {
    // Security regression test: this must mount synchronously without
    // hanging or overflowing the call stack, even for a body far deeper
    // than any legitimate RequestContext would ever be.
    const data = buildDeeplyNested(500);

    const wrapper = mount(KeyValueTree, { props: { data } });

    expect(wrapper.text()).toContain('max depth reached');
    expect(wrapper.text()).not.toContain('bottom');
  });

  it('truncates a long array instead of joining every element', () => {
    const longArray = Array.from({ length: 100 }, (_, i) => `item-${i}`);
    const wrapper = mount(KeyValueTree, { props: { data: { orders: longArray } } });

    expect(wrapper.text()).toContain('item-0');
    expect(wrapper.text()).toContain('more)');
    expect(wrapper.text()).not.toContain('item-99');
  });

  it('hides excess keys beyond the per-level cap', () => {
    const wideObject = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`field${i}`, i]));
    const wrapper = mount(KeyValueTree, { props: { data: wideObject } });

    expect(wrapper.text()).toContain('more field(s) hidden');
  });

  it('truncates an excessively long scalar value', () => {
    const wrapper = mount(KeyValueTree, { props: { data: { note: 'x'.repeat(2000) } } });

    expect(wrapper.text()).toContain('truncated');
    expect(wrapper.text().length).toBeLessThan(2000);
  });
});
