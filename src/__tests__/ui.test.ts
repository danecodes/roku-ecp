import { describe, it, expect } from 'vitest';
import { parseUiXml, findElement, findElements, findFocused, formatTree, getRect } from '../ui.js';

const HOME_PAGE_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<app-ui>
  <topscreen>
    <screen>
      <HomePage name="homepage">
        <NavMenu name="nav">
          <AppButton name="homeBtn" focused="true" text="Home" />
          <AppButton name="browseBtn" focused="false" text="Browse" />
        </NavMenu>
        <HeroCarousel name="hero" visible="true" />
        <LayoutGroup name="rail">
          <AppLabel name="title" text="Continue Watching" />
          <AppButton name="card1" text="Episode 1" />
          <AppButton name="card2" text="Episode 2" />
        </LayoutGroup>
      </HomePage>
    </screen>
  </topscreen>
</app-ui>`;

const NO_FOCUS_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<app-ui>
  <topscreen>
    <screen>
      <VideoPlayer name="player">
        <AppButton name="playBtn" text="Play" />
      </VideoPlayer>
    </screen>
  </topscreen>
</app-ui>`;

const DEEP_FOCUS_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<app-ui>
  <topscreen>
    <screen>
      <SeriesPage name="series">
        <EpisodeList name="list">
          <EpisodeRow name="row1">
            <EpisodeCard name="ep1" focused="false" />
            <EpisodeCard name="ep2" focused="true" text="Episode 2" />
          </EpisodeRow>
        </EpisodeList>
      </SeriesPage>
    </screen>
  </topscreen>
</app-ui>`;

const BOUNDS_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<app-ui>
  <topscreen>
    <screen>
      <HomePage name="home" bounds="{0, 0, 1920, 1080}" translation="[0, 0]">
        <NavBar name="navbar" bounds="{0, 0, 1920, 90}" translation="[0, 0]">
          <NavTab name="tab1" bounds="{0, 0, 200, 90}" translation="[100, 0]" focused="true" />
          <NavTab name="tab2" bounds="{0, 0, 200, 90}" translation="[300, 0]" />
        </NavBar>
        <ContentArea name="content" bounds="{0, 0, 1920, 990}" translation="[0, 90]">
          <FocusGroup name="row1" bounds="{0, 0, 1920, 300}" translation="[0, 100]">
            <Card name="card1" bounds="{0, 0, 400, 300}" translation="[50, 0]" />
          </FocusGroup>
          <NoInherit name="detached" bounds="{10, 20, 100, 50}" translation="[0, 0]" inheritParentTransform="false" />
        </ContentArea>
      </HomePage>
    </screen>
  </topscreen>
</app-ui>`;

describe('getRect', () => {
  it('returns absolute position accumulating parent translations', async () => {
    const tree = await parseUiXml(BOUNDS_XML);
    // card1: bounds {0,0,400,300}, translation [50,0]
    // parent FocusGroup: translation [0,100]
    // parent ContentArea: translation [0,90]
    // parent HomePage: translation [0,0]
    // Absolute: x=0+50+0+0=50... wait, bounds is the local rect, translation is the node's own offset
    // Actually: card1 bounds={0,0,400,300}. Walk parents:
    //   FocusGroup translation=[0,100] → x+=0, y+=100
    //   ContentArea translation=[0,90] → x+=0, y+=90
    //   HomePage translation=[0,0] → no change
    // Result: {0, 190, 400, 300}
    const card = findElement(tree, '#card1');
    expect(card).toBeDefined();
    const rect = getRect(card!);
    expect(rect).toEqual({ x: 0, y: 190, width: 400, height: 300 });
  });

  it('returns local bounds when no parent translations', async () => {
    const tree = await parseUiXml(BOUNDS_XML);
    const rect = getRect(tree);
    expect(rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('stops accumulating at inheritParentTransform=false', async () => {
    const tree = await parseUiXml(BOUNDS_XML);
    const detached = findElement(tree, '#detached');
    expect(detached).toBeDefined();
    const rect = getRect(detached!);
    // inheritParentTransform=false on the node itself, so no parent translations added
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('returns undefined when no bounds attribute', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const rect = getRect(tree);
    expect(rect).toBeUndefined();
  });
});

describe('parseUiXml', () => {
  it('unwraps app-ui/topscreen/screen wrappers', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(tree.tag).toBe('HomePage');
  });

  it('preserves attributes', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(tree.attrs.name).toBe('homepage');
  });

  it('builds parent references', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const nav = tree.children[0];
    expect(nav.parent).toBe(tree);
  });
});

describe('findElement', () => {
  it('finds by tag name', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'HeroCarousel')?.tag).toBe('HeroCarousel');
  });

  it('finds by #name', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, '#title')?.attrs.text).toBe('Continue Watching');
  });

  it('finds by tag#name', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'AppButton#card2')?.attrs.text).toBe('Episode 2');
  });

  it('finds by descendant selector', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'LayoutGroup AppLabel')?.attrs.name).toBe('title');
  });

  it('finds by child selector', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'HomePage > NavMenu')?.attrs.name).toBe('nav');
  });

  it('returns undefined for non-existent selector', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'NonExistent')).toBeUndefined();
  });

  it('nth-child selector works', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'AppButton:nth-child(1)')?.attrs.name).toBe('homeBtn');
  });
});

describe('attribute selectors', () => {
  it('[attr="value"] matches attribute value', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, '[focused="true"]')?.attrs.name).toBe('homeBtn');
  });

  it('[attr] matches attribute existence', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const matches = findElements(tree, '[visible]');
    expect(matches.length).toBe(1);
    expect(matches[0].attrs.name).toBe('hero');
  });

  it('Tag[attr="value"] combines tag and attribute', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'AppButton[focused="true"]')?.attrs.name).toBe('homeBtn');
  });

  it('Tag#id[attr="value"] combines tag, id, and attribute', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'AppButton#homeBtn[focused="true"]')?.attrs.name).toBe('homeBtn');
    expect(findElement(tree, 'AppButton#homeBtn[focused="false"]')).toBeUndefined();
  });

  it('[attr="value"] works in descendant selectors', async () => {
    const tree = await parseUiXml(DEEP_FOCUS_XML);
    expect(findElement(tree, 'EpisodeRow EpisodeCard[focused="true"]')?.attrs.name).toBe('ep2');
  });

  it('[attr="value with spaces"] matches values containing spaces', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, '[text="Continue Watching"]')?.attrs.name).toBe('title');
    expect(findElement(tree, 'AppLabel[text="Continue Watching"]')?.attrs.name).toBe('title');
    expect(findElement(tree, 'AppButton[text="Episode 1"]')?.attrs.name).toBe('card1');
  });
});

describe('substring attribute matching', () => {
  it('[attr*="value"] matches substring', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, '[text*="Continue"]')?.attrs.name).toBe('title');
    expect(findElement(tree, '[text*="Episode"]')?.attrs.name).toBe('card1');
  });

  it('[attr*="value"] returns undefined on no match', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, '[text*="Nonexistent"]')).toBeUndefined();
  });

  it('Tag[attr*="value"] combines tag and substring', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'AppLabel[text*="Continue"]')?.attrs.name).toBe('title');
    expect(findElement(tree, 'AppButton[text*="Continue"]')).toBeUndefined();
  });
});

describe(':has() pseudo-selector', () => {
  it('matches parent that has a child matching subselector', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const nav = findElement(tree, 'NavMenu:has(AppButton[focused="true"])');
    expect(nav?.attrs.name).toBe('nav');
  });

  it('matches with tag name in :has()', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const group = findElement(tree, 'LayoutGroup:has(AppLabel)');
    expect(group?.attrs.name).toBe('rail');
  });

  it('returns undefined when :has() condition not met', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'NavMenu:has(HeroCarousel)')).toBeUndefined();
  });

  it(':has() with adjacent sibling combinator', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const home = findElement(tree, 'HomePage:has(AppButton[text="Episode 1"])');
    expect(home?.tag).toBe('HomePage');
  });

  it(':has(+ Sibling) matches node that has a next sibling', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    // homeBtn has adjacent sibling browseBtn, so homeBtn:has(+ AppButton) should not match
    // (homeBtn has no children). But AppButton#homeBtn that has a next sibling AppButton:
    // Actually :has(+ X) means "this element's next sibling matches X"
    // NavMenu:has(+ HeroCarousel) — NavMenu is followed by HeroCarousel
    const nav = findElement(tree, 'NavMenu:has(+ HeroCarousel)');
    expect(nav?.attrs.name).toBe('nav');
  });

  it(':has(+ Sibling) returns undefined when no matching sibling', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    // LayoutGroup has no next sibling, so this should not match
    expect(findElement(tree, 'LayoutGroup:has(+ HeroCarousel)')).toBeUndefined();
  });

  it(':has(~ Sibling) matches node with any following sibling', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    // NavMenu ~ LayoutGroup: NavMenu has LayoutGroup as a following sibling
    const nav = findElement(tree, 'NavMenu:has(~ LayoutGroup)');
    expect(nav?.attrs.name).toBe('nav');
  });
});

describe('comma-separated selector groups', () => {
  it('matches either selector', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const results = findElements(tree, 'HeroCarousel, AppLabel');
    expect(results.length).toBe(2);
    const tags = results.map(n => n.tag).sort();
    expect(tags).toEqual(['AppLabel', 'HeroCarousel']);
  });

  it('deduplicates when both selectors match same node', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const results = findElements(tree, 'HeroCarousel, HeroCarousel');
    expect(results.length).toBe(1);
  });
});

describe(':not() pseudo-selector', () => {
  it('excludes nodes matching the inner selector', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const unfocused = findElements(tree, 'AppButton:not([focused="true"])');
    for (const node of unfocused) {
      expect(node.attrs.focused).not.toBe('true');
    }
    expect(unfocused.length).toBeGreaterThanOrEqual(3);
  });

  it('combines with tag name', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const notCards = findElements(tree, 'AppButton:not([text*="Episode"])');
    for (const node of notCards) {
      expect(node.attrs.text ?? '').not.toContain('Episode');
    }
  });
});

describe(':first-child and :last-child', () => {
  it(':first-child matches first child', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'AppButton:first-child')?.attrs.name).toBe('homeBtn');
  });

  it(':last-child matches last child', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const last = findElement(tree, 'LayoutGroup > AppButton:last-child');
    expect(last?.attrs.name).toBe('card2');
  });
});

describe('attribute starts/ends with', () => {
  it('[attr^="value"] matches prefix', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, '[text^="Continue"]')?.attrs.name).toBe('title');
    expect(findElement(tree, '[text^="Episode"]')?.attrs.name).toBe('card1');
  });

  it('[attr$="value"] matches suffix', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, '[text$="Watching"]')?.attrs.name).toBe('title');
    expect(findElement(tree, '[text$="2"]')?.attrs.name).toBe('card2');
  });

  it('no match returns undefined', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, '[text^="Zzz"]')).toBeUndefined();
    expect(findElement(tree, '[text$="Zzz"]')).toBeUndefined();
  });
});

describe('universal selector', () => {
  it('* matches all nodes', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const all = findElements(tree, '*');
    expect(all.length).toBeGreaterThanOrEqual(7);
  });

  it('*[attr] matches any tag with attribute', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const visible = findElements(tree, '*[visible]');
    expect(visible.length).toBe(1);
    expect(visible[0].attrs.name).toBe('hero');
  });
});

describe('general sibling combinator ~', () => {
  it('matches all following siblings', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    // NavMenu ~ anything should match HeroCarousel and LayoutGroup
    const results = findElements(tree, 'NavMenu ~ LayoutGroup');
    expect(results.length).toBe(1);
    expect(results[0].attrs.name).toBe('rail');
  });

  it('matches multiple following siblings', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    // homeBtn ~ AppButton should match browseBtn
    const results = findElements(tree, 'AppButton#homeBtn ~ AppButton');
    expect(results.length).toBe(1);
    expect(results[0].attrs.name).toBe('browseBtn');
  });
});

describe(':nth-child(odd/even/An+B)', () => {
  it(':nth-child(odd) matches 1st, 3rd, etc.', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    // In NavMenu: homeBtn is 1st (odd), browseBtn is 2nd (even)
    const odd = findElements(tree, 'NavMenu > AppButton:nth-child(odd)');
    expect(odd.length).toBe(1);
    expect(odd[0].attrs.name).toBe('homeBtn');
  });

  it(':nth-child(even) matches 2nd, 4th, etc.', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const even = findElements(tree, 'NavMenu > AppButton:nth-child(even)');
    expect(even.length).toBe(1);
    expect(even[0].attrs.name).toBe('browseBtn');
  });

  it(':nth-child(2n+1) matches odd positions', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const results = findElements(tree, 'NavMenu > AppButton:nth-child(2n+1)');
    expect(results.length).toBe(1);
    expect(results[0].attrs.name).toBe('homeBtn');
  });
});

describe(':only-child', () => {
  it('matches node that is the sole child', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    // HeroCarousel has no children with name, but let's check LayoutGroup > AppLabel
    // Actually HeroCarousel is not an only child. Let's use a structure where it applies.
    // In HOME_PAGE_XML, no node is an only child in the main tree.
    // Use NO_FOCUS_XML where AppButton is only child of VideoPlayer
    const noFocusTree = await parseUiXml(NO_FOCUS_XML);
    const result = findElement(noFocusTree, 'AppButton:only-child');
    expect(result?.attrs.name).toBe('playBtn');
  });

  it('does not match when siblings exist', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    // NavMenu has two AppButtons, neither is only-child
    const result = findElement(tree, 'NavMenu > AppButton:only-child');
    expect(result).toBeUndefined();
  });
});

describe(':empty', () => {
  it('matches nodes with no children', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    // HeroCarousel has no children
    const result = findElement(tree, 'HeroCarousel:empty');
    expect(result?.attrs.name).toBe('hero');
  });

  it('does not match nodes with children', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findElement(tree, 'NavMenu:empty')).toBeUndefined();
  });
});

describe('findElements', () => {
  it('returns all matches', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const buttons = findElements(tree, 'AppButton');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });
});

describe('findFocused', () => {
  it('returns undefined when nothing is focused', async () => {
    const tree = await parseUiXml(NO_FOCUS_XML);
    expect(findFocused(tree)).toBeUndefined();
  });

  it('finds focused element', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    expect(findFocused(tree)?.attrs.name).toBe('homeBtn');
  });

  it('finds deeply nested focus', async () => {
    const tree = await parseUiXml(DEEP_FOCUS_XML);
    expect(findFocused(tree)?.attrs.name).toBe('ep2');
  });
});

describe('formatTree', () => {
  it('renders a readable tree string', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const output = formatTree(tree, { maxDepth: 1 });
    expect(output).toContain('HomePage');
    expect(output).toContain('NavMenu');
  });

  it('respects maxDepth', async () => {
    const tree = await parseUiXml(HOME_PAGE_XML);
    const output = formatTree(tree, { maxDepth: 0 });
    expect(output).not.toContain('NavMenu');
  });
});
