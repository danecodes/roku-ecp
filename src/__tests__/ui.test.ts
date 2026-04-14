import { describe, it, expect } from 'vitest';
import { parseUiXml, findElement, findElements, findFocused, formatTree } from '../ui.js';

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
