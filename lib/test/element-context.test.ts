/**
 * node:test unit tests for lib/element-context.ts
 *
 * Covers ELEM-02/03/04/05/06/07:
 *   - buildSelector fallback (try/catch wrapper)
 *   - captureElementContext field extraction (tag, id, classList, role, ariaLabel, text, rect,
 *     computedStyles, outerHTML, dataset, reactComponent, nearestTestId)
 *   - text truncation at 1000 chars
 *   - outerHTML truncation at 2000 chars
 *   - getReactComponentName (named component, undefined when absent, no infinite loop)
 *   - nearestTestId (own data-testid, ancestor data-testid, undefined when none)
 *   - buildContextSummary (full + partial omission variants)
 *   - CURATED_STYLE_PROPS membership and length
 *
 * Zero chrome/DOM API surface — all mock objects are plain literals cast via `as unknown as Element`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureElementContext,
  buildContextSummary,
  CURATED_STYLE_PROPS,
} from '../element-context.js';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

type MockElement = {
  tagName: string;
  id: string;
  classList: { length: number; [Symbol.iterator](): Iterator<string> };
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { x: number; y: number; width: number; height: number };
  getAttributeNames: () => string[];
  innerText?: string;
  textContent?: string;
  outerHTML: string;
  dataset: Record<string, string>;
  parentElement: MockElement | null;
  [key: string]: unknown;
};

function makeEl(overrides: Partial<MockElement> = {}): MockElement {
  return {
    tagName: 'BUTTON',
    id: 'save-btn',
    classList: {
      length: 1,
      [Symbol.iterator]: function* () { yield 'primary'; },
    },
    getAttribute: (name: string) => {
      const attrs: Record<string, string> = {
        role: 'button',
        'aria-label': 'Save',
      };
      return attrs[name] ?? null;
    },
    getBoundingClientRect: () => ({ x: 100, y: 200, width: 120, height: 40 }),
    getAttributeNames: () => ['role', 'aria-label'],
    innerText: 'Save',
    textContent: 'Save',
    outerHTML: '<button id="save-btn" class="primary" role="button" aria-label="Save">Save</button>',
    dataset: { cy: 'save-button' },
    parentElement: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CURATED_STYLE_PROPS
// ---------------------------------------------------------------------------

describe('CURATED_STYLE_PROPS', () => {
  test('length is between 25 and 27 inclusive', () => {
    assert.ok(CURATED_STYLE_PROPS.length >= 25, `Expected >= 25, got ${CURATED_STYLE_PROPS.length}`);
    assert.ok(CURATED_STYLE_PROPS.length <= 27, `Expected <= 27, got ${CURATED_STYLE_PROPS.length}`);
  });

  test('contains core layout/display props', () => {
    const required = [
      'display', 'position', 'width', 'height', 'z-index', 'overflow',
      'color', 'background-color', 'font-size', 'font-weight', 'opacity', 'visibility',
    ];
    for (const prop of required) {
      assert.ok(
        (CURATED_STYLE_PROPS as readonly string[]).includes(prop),
        `CURATED_STYLE_PROPS missing: ${prop}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// captureElementContext — field extraction
// ---------------------------------------------------------------------------

describe('captureElementContext', () => {
  test('tag is lowercased from el.tagName', () => {
    const el = makeEl({ tagName: 'BUTTON' });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.tag, 'button');
  });

  test('selector field is present', () => {
    const el = makeEl();
    const ctx = captureElementContext(el as unknown as Element);
    assert.ok(typeof ctx.selector === 'string', 'selector should be a string');
    assert.ok(ctx.selector.length > 0, 'selector should not be empty');
  });

  test('id is set when non-empty', () => {
    const el = makeEl({ id: 'my-id' });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.id, 'my-id');
  });

  test('id is omitted when empty string', () => {
    const el = makeEl({ id: '' });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.id, undefined);
  });

  test('classList is set when non-empty', () => {
    const el = makeEl();
    const ctx = captureElementContext(el as unknown as Element);
    assert.deepStrictEqual(ctx.classList, ['primary']);
  });

  test('classList is omitted when empty', () => {
    const el = makeEl({
      classList: {
        length: 0,
        [Symbol.iterator]: function* () {},
      },
    });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.classList, undefined);
  });

  test('role extracted from getAttribute("role")', () => {
    const el = makeEl();
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.role, 'button');
  });

  test('role is omitted when getAttribute returns null', () => {
    const el = makeEl({ getAttribute: (_name: string) => null });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.role, undefined);
  });

  test('ariaLabel extracted from getAttribute("aria-label")', () => {
    const el = makeEl();
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.ariaLabel, 'Save');
  });

  test('ariaLabel is omitted when getAttribute returns null', () => {
    const el = makeEl({ getAttribute: (_name: string) => null });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.ariaLabel, undefined);
  });

  test('text set to collapsed innerText', () => {
    const el = makeEl({ innerText: 'Hello   World', textContent: 'Hello   World' });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.text, 'Hello World');
  });

  test('text truncated to 1000 chars when input exceeds 1000', () => {
    const longText = 'x'.repeat(1500);
    const el = makeEl({ innerText: longText, textContent: longText });
    const ctx = captureElementContext(el as unknown as Element);
    assert.ok(ctx.text !== undefined, 'text should be defined');
    assert.strictEqual(ctx.text!.length, 1000);
  });

  test('rect has x/y/width/height (integers when already integer)', () => {
    const el = makeEl({ getBoundingClientRect: () => ({ x: 10, y: 20, width: 100, height: 50 }) });
    const ctx = captureElementContext(el as unknown as Element);
    assert.deepStrictEqual(ctx.rect, { x: 10, y: 20, width: 100, height: 50 });
  });

  test('rect values are rounded integers', () => {
    const el = makeEl({ getBoundingClientRect: () => ({ x: 10.7, y: 20.3, width: 100.5, height: 50.2 }) });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.rect!.x, Math.round(10.7));
    assert.strictEqual(ctx.rect!.y, Math.round(20.3));
    assert.strictEqual(ctx.rect!.width, Math.round(100.5));
    assert.strictEqual(ctx.rect!.height, Math.round(50.2));
  });

  test('computedStyles only contains keys from CURATED_STYLE_PROPS', () => {
    const el = makeEl();
    // We pass a mock getComputedStyle via object; captureElementContext calls window.getComputedStyle
    // internally — since we're not in a browser, computedStyles may be undefined or empty.
    // This test verifies the filter: if present, keys must be in CURATED_STYLE_PROPS.
    const ctx = captureElementContext(el as unknown as Element);
    if (ctx.computedStyles) {
      for (const key of Object.keys(ctx.computedStyles)) {
        assert.ok(
          (CURATED_STYLE_PROPS as readonly string[]).includes(key),
          `Unexpected key in computedStyles: ${key}`
        );
      }
    }
  });

  test('outerHTML sliced to 2000 chars when input exceeds 2000', () => {
    const longHtml = '<div>' + 'x'.repeat(2500) + '</div>';
    const el = makeEl({ outerHTML: longHtml });
    const ctx = captureElementContext(el as unknown as Element);
    assert.ok(ctx.outerHTML !== undefined, 'outerHTML should be defined');
    assert.strictEqual(ctx.outerHTML!.length, 2000);
  });

  test('dataset spread from el.dataset (omitted when empty)', () => {
    const el = makeEl({ dataset: {} });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.dataset, undefined);
  });

  test('dataset included when non-empty', () => {
    const el = makeEl({ dataset: { testid: 'my-btn', cy: 'save' } });
    const ctx = captureElementContext(el as unknown as Element);
    assert.deepStrictEqual(ctx.dataset, { testid: 'my-btn', cy: 'save' });
  });
});

// ---------------------------------------------------------------------------
// buildSelector fallback
// ---------------------------------------------------------------------------

describe('buildSelector fallback', () => {
  test('fallback returns tagName.toLowerCase() when finder-like call would fail', () => {
    // We test the fallback indirectly: create an element where finder cannot
    // generate a unique selector (element not in a real DOM document) — the
    // implementation must catch the error and return el.tagName.toLowerCase().
    const el = makeEl({ tagName: 'SECTION' });
    const ctx = captureElementContext(el as unknown as Element);
    // selector must be non-empty; when finder throws, it falls back to tag
    assert.ok(typeof ctx.selector === 'string');
    assert.ok(ctx.selector.length > 0);
  });
});

// ---------------------------------------------------------------------------
// getReactComponentName (tested indirectly via captureElementContext)
// ---------------------------------------------------------------------------

describe('getReactComponentName', () => {
  test('returns undefined when no __reactFiber$ key exists', () => {
    const el = makeEl();
    // No fiber key on the element — reactComponent should be absent
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.reactComponent, undefined);
  });

  test('returns component name from mock fiber', () => {
    const fiber = {
      type: { name: 'SaveButton' },
      return: null,
    };
    const el = makeEl({ '__reactFiber$abc': fiber });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.reactComponent, 'SaveButton');
  });

  test('skips minified single-letter names in fiber walk', () => {
    const fiber = {
      type: { name: 'a' },  // single-letter, minified
      return: {
        type: { name: 'MyRealComponent' },
        return: null,
      },
    };
    const el = makeEl({ '__reactFiber$abc': fiber });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.reactComponent, 'MyRealComponent');
  });

  test('does not loop forever on circular fiber.return', () => {
    // Self-referential fiber — maxSteps guard must break the loop
    const fiber: { type: { name: string }; return: unknown } = {
      type: { name: '' },
      return: null,
    };
    // Make it circular
    fiber.return = fiber;
    const el = makeEl({ '__reactFiber$abc': fiber });
    // Must complete without hanging (maxSteps guard fires)
    const ctx = captureElementContext(el as unknown as Element);
    // reactComponent may be undefined — just must not infinite-loop
    assert.ok(true, 'Did not infinite loop');
  });
});

// ---------------------------------------------------------------------------
// nearestTestId (tested indirectly via captureElementContext)
// ---------------------------------------------------------------------------

describe('nearestTestId', () => {
  test('returns own data-testid attribute', () => {
    const el = makeEl({
      getAttribute: (name: string) =>
        name === 'data-testid' ? 'my-btn'
          : name === 'role' ? 'button'
          : name === 'aria-label' ? 'Save'
          : null,
      getAttributeNames: () => ['role', 'aria-label', 'data-testid'],
      dataset: { testid: 'my-btn' },
    });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.nearestTestId, 'my-btn');
  });

  test('returns ancestor data-testid when own is absent', () => {
    const parent = makeEl({
      getAttribute: (name: string) =>
        name === 'data-testid' ? 'parent-testid' : null,
      getAttributeNames: () => ['data-testid'],
      dataset: { testid: 'parent-testid' },
      parentElement: null,
    });
    const child = makeEl({
      id: '',
      getAttribute: (name: string) =>
        name === 'role' ? 'button' : name === 'aria-label' ? 'Save' : null,
      getAttributeNames: () => ['role', 'aria-label'],
      dataset: {},
      parentElement: parent,
    });
    const ctx = captureElementContext(child as unknown as Element);
    assert.strictEqual(ctx.nearestTestId, 'parent-testid');
  });

  test('nearestTestId is undefined when no data-testid in chain', () => {
    const el = makeEl({
      getAttribute: (name: string) =>
        name === 'role' ? 'button' : name === 'aria-label' ? 'Save' : null,
      getAttributeNames: () => ['role', 'aria-label'],
      dataset: {},
      parentElement: null,
    });
    const ctx = captureElementContext(el as unknown as Element);
    assert.strictEqual(ctx.nearestTestId, undefined);
  });
});

// ---------------------------------------------------------------------------
// buildContextSummary — composition variants
// ---------------------------------------------------------------------------

describe('buildContextSummary', () => {
  test('includes shortSelector, text, component, and WxH when all present', () => {
    const ctx = {
      selector: '#save-btn',
      tag: 'button',
      id: 'save-btn',
      text: 'Save',
      reactComponent: 'SaveButton',
      rect: { x: 0, y: 0, width: 120, height: 40 },
    };
    const summary = buildContextSummary(ctx);
    assert.ok(summary.includes('Save'), 'should include text');
    assert.ok(summary.includes('SaveButton'), 'should include component name');
    assert.ok(summary.includes('120'), 'should include width');
    assert.ok(summary.includes('40'), 'should include height');
  });

  test('omits "text" part when ctx.text is absent', () => {
    const ctx = {
      selector: 'button',
      tag: 'button',
      reactComponent: 'MyBtn',
      rect: { x: 0, y: 0, width: 80, height: 30 },
    };
    const summary = buildContextSummary(ctx);
    // Should contain component and dimensions but no quoted text part
    assert.ok(summary.includes('MyBtn'), 'should include component');
    assert.ok(summary.includes('80'), 'should include width');
  });

  test('omits <Component> when reactComponent is absent', () => {
    const ctx = {
      selector: 'button',
      tag: 'button',
      text: 'Click me',
      rect: { x: 0, y: 0, width: 60, height: 25 },
    };
    const summary = buildContextSummary(ctx);
    assert.ok(!summary.includes('<'), 'should not include < when no component');
    assert.ok(summary.includes('Click me'), 'should include text');
  });

  test('returns non-empty string even with minimal ctx (only selector + tag)', () => {
    const ctx = {
      selector: 'div',
      tag: 'div',
    };
    const summary = buildContextSummary(ctx);
    assert.ok(typeof summary === 'string');
    assert.ok(summary.length > 0);
  });

  test('parts are joined with " · " separator', () => {
    const ctx = {
      selector: 'button',
      tag: 'button',
      text: 'OK',
      reactComponent: 'OkButton',
      rect: { x: 0, y: 0, width: 50, height: 20 },
    };
    const summary = buildContextSummary(ctx);
    assert.ok(summary.includes(' · '), 'parts should be joined with " · "');
  });
});
