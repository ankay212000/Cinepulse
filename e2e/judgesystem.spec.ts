import { expect, test } from '@playwright/test';

test.describe('JudgeSystem End-to-End Verification', () => {
  test('renders mixed-difficulty problemset with 14-question pagination', async ({
    page,
  }) => {
    await page.goto('/problemset');
    await expect(page.locator('h1')).toContainText(/Problem|System Design|Catalog/i);

    const problemRows = page.locator('tbody tr');
    await expect(problemRows).toHaveCount(14);

    // Navigate to Page 2 and confirm pagination advances cleanly
    const page2Btn = page.getByRole('button', { name: '2', exact: true });
    await expect(page2Btn).toBeVisible();
    await page2Btn.click();
    await expect(problemRows).toHaveCount(14);
  });

  test('cycles difficulty sorting cleanly (Mixed -> Easy..Expert -> Expert..Easy -> Mixed)', async ({
    page,
  }) => {
    await page.goto('/problemset');
    const diffCells = page.locator('tbody tr td:nth-child(5)');
    await expect(diffCells).toHaveCount(14);

    // Default is mixed difficulty (not all Easy)
    const initialDifficulties = await diffCells.allInnerTexts();
    expect(new Set(initialDifficulties).size).toBeGreaterThan(1);

    const diffSortBtn = page.locator('thead th').getByRole('button', {
      name: /Difficulty/i,
    });

    // Click 1: Ascending (Easy -> Expert) — all 14 rows on Page 1 are Easy
    await diffSortBtn.click();
    await expect(diffCells.first()).toHaveText('Easy');
    const ascDifficulties = await diffCells.allInnerTexts();
    expect(ascDifficulties.every((d) => d.trim() === 'Easy')).toBe(true);

    // Click 2: Descending (Expert -> Easy) — all 15 Expert problems start on Page 1 (all 14 rows are Expert)
    await diffSortBtn.click();
    await expect(diffCells.first()).toHaveText('Expert');
    const descDifficulties = await diffCells.allInnerTexts();
    expect(descDifficulties.every((d) => d.trim() === 'Expert')).toBe(true);

    // Click 3: Back to Mixed default
    await diffSortBtn.click();
    const resetDifficulties = await diffCells.allInnerTexts();
    expect(resetDifficulties).toEqual(initialDifficulties);
  });

  test('never displays AC status from localStorage when user is signed out', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const fakeAcRecord = {
        'distributed-rate-limiter': [
          {
            submissionId: 'sub_1',
            submissionName: 'Run #1',
            submittedAtIso: '2026-11-08T12:00:00.000Z',
            problemId: 'distributed-rate-limiter',
            snapshot: { nodes: [], edges: [], boundaries: [], writeupMarkdown: '' },
            verdict: 'AC',
            totalScore: 480,
          },
        ],
        'url-shortener': [
          {
            submissionId: 'sub_2',
            submissionName: 'Run #1',
            submittedAtIso: '2026-11-08T12:00:00.000Z',
            problemId: 'url-shortener',
            snapshot: { nodes: [], edges: [], boundaries: [], writeupMarkdown: '' },
            verdict: 'AC',
            totalScore: 950,
          },
        ],
      };
      window.localStorage.setItem(
        'sysjudge_runs_meta_v1',
        JSON.stringify(fakeAcRecord)
      );
      window.localStorage.setItem(
        'sysjudge_runs_meta_v2:prev_logged_in_uid',
        JSON.stringify(fakeAcRecord)
      );
    });

    await page.goto('/problemset');
    await expect(page.locator('tbody tr')).toHaveCount(14);
    await expect(
      page.locator('tbody tr td:first-child', { hasText: /^AC$/ })
    ).toHaveCount(0);
    await expect(
      page.locator('tbody tr td:first-child', { hasText: /^—$/ })
    ).toHaveCount(14);
  });

  test('renders modularized ArenaWorkspace and WhiteboardCanvas cleanly', async ({
    page,
  }) => {
    await page.goto('/problems/url-shortener');
    await expect(page.locator('text=HLD-201').first()).toBeVisible();
    await expect(
      page.locator('text=High-Throughput URL Shortener & Redirector').first()
    ).toBeVisible();
  });

  test('executes sample test cases and flags writeup-vs-diagram alignment drift', async ({
    request,
  }) => {
    const runRes = await request.post('/api/judge/run', {
      data: {
        problemId: 'url-shortener',
        snapshot: {
          nodes: [
            { id: 'c1', label: 'Users', x: 60, y: 140, width: 130, height: 60 },
            {
              id: 's1',
              label: 'Redirect Service',
              x: 280,
              y: 140,
              width: 150,
              height: 64,
            },
          ],
          edges: [{ id: 'e1', from: 'c1', to: 's1' }],
          boundaries: [],
          writeupMarkdown:
            '# Architecture\nWe use Redis Cluster cache-aside and DynamoDB multi-AZ storage.',
        },
      },
    });

    expect(runRes.status()).toBe(200);
    expect(runRes.headers()['x-ratelimit-remaining']).toBeTruthy();

    const body = await runRes.json();
    expect(body.problemId).toBe('url-shortener');
    expect(Array.isArray(body.testSuite?.alignmentFlags)).toBe(true);
    expect(body.testSuite.alignmentFlags.length).toBeGreaterThan(0);
  });

  test('enforces 256 KB request payload cap and no-store cache headers on judge API', async ({
    request,
  }) => {
    const oversized = 'x'.repeat(270_000);
    const res = await request.post('/api/judge/evaluate', {
      data: {
        problemId: 'url-shortener',
        snapshot: {
          nodes: [],
          edges: [],
          boundaries: [],
          writeupMarkdown: oversized,
        },
      },
    });

    expect(res.status()).toBe(413);
  });

  test('displays write-up evaluation rules in textarea placeholder & rules strip and inserts FR/NFR template', async ({
    page,
    request,
  }) => {
    await page.goto('/problems/pastebin-snippets');

    // Left sidebar shows standardized FR-1..FR-4 badges and visible Rulebook hyperlink after the question
    await expect(page.locator('text=FR-1').first()).toBeVisible();
    await expect(page.locator('text=FR-4').first()).toBeVisible();
    await expect(
      page.locator('text=60% FR & Write-up · 40% NFR Sim')
    ).toHaveCount(0);

    const rulebookLink = page.locator('#question-rulebook-link');
    await expect(rulebookLink).toBeVisible();
    await expect(rulebookLink).toContainText(
      'Rules: Costing price & marks distribution'
    );
    await expect(rulebookLink).toHaveAttribute('href', '/rules');

    // Textarea placeholder contains evaluation rules ONLY (no solution spoilers)
    const textarea = page.locator('#design-writeup-textarea');
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder).toContain('HOW YOUR WRITE-UP IS EVALUATED');
    expect(placeholder).toContain('60% FR & Plain-English Write-up');
    expect(placeholder).toContain('WA_FUNCTIONAL');
    expect(placeholder).not.toContain('PLAIN-ENGLISH EXAMPLE STYLE');
    expect(placeholder).not.toMatch(/\b(Snowflake|UUIDv7|Redis|Kafka|cache-aside|singleflight)\b/i);

    // Unlock via local dummy user if rendered in development mode
    const dummyBtn = page.getByRole('button', { name: /Use Dummy User/i }).first();
    if (await dummyBtn.isVisible()) {
      await dummyBtn.click();
      // "Rules" button beside Insert FR/NFR Template is removed
      await expect(page.locator('#toggle-writeup-rules-btn')).toHaveCount(0);
      await expect(page.locator('#writeup-evaluation-rules')).toHaveCount(0);

      await page.locator('#insert-writeup-template-btn').click();
      await expect(textarea).toHaveValue(/### FR-1:/);
      await expect(textarea).toHaveValue(/### FR-4:/);
    }

    // Visit dedicated /rules Rulebook page and verify marks distribution & costing schedule
    await page.goto('/rules');
    await expect(page.locator('#rulebook-heading')).toBeVisible();
    await expect(page.locator('#marks-distribution-table')).toBeVisible();
    await expect(page.locator('#standardized-cost-rate-table')).toBeVisible();
    await expect(page.locator('#standardized-cost-rate-table')).toContainText(
      'In-Memory Cache'
    );

    // API verifies WA_FUNCTIONAL when writeup is keyword-only spam
    const evalRes = await request.post('/api/judge/evaluate', {
      data: {
        problemId: 'pastebin-snippets',
        submissionName: 'E2E Keyword Spam Check',
        snapshot: {
          nodes: [
            { id: 'c', label: 'Users', x: 20, y: 120, width: 120, height: 60 },
            { id: 'cdn', label: 'CloudFront CDN', x: 180, y: 80, width: 150, height: 64 },
            {
              id: 'lb',
              label: 'ALB Load Balancer x2 medium',
              x: 180,
              y: 180,
              width: 150,
              height: 64,
            },
            {
              id: 'api',
              label: 'Snippet API x4 medium || SingleFlight',
              x: 380,
              y: 140,
              width: 170,
              height: 70,
            },
            {
              id: 'redis',
              label: 'Redis Cache x2 16GB || Multi-AZ',
              x: 610,
              y: 80,
              width: 160,
              height: 64,
            },
            {
              id: 'db',
              label: 'DynamoDB Metadata Store 2 shards || Multi-AZ',
              x: 610,
              y: 200,
              width: 170,
              height: 70,
            },
          ],
          edges: [
            { id: 'e1', from: 'c', to: 'cdn' },
            { id: 'e2', from: 'cdn', to: 'lb' },
            { id: 'e3', from: 'lb', to: 'api' },
            { id: 'e4', from: 'api', to: 'redis' },
            { id: 'e5', from: 'api', to: 'db' },
          ],
          boundaries: [],
          writeupMarkdown: 'Redis DynamoDB CDN ALB Snowflake Sharding TTL Quorum',
        },
      },
    });
    expect(evalRes.status()).toBe(200);
    const evalBody = await evalRes.json();
    expect(evalBody.score.verdict).toBe('WA_FUNCTIONAL');
  });

  test('renders competitive Architect Rating and Rating Progression Graph on /profile', async ({
    page,
  }) => {
    await page.goto('/profile?dummy=1');

    const ratingCard = page.locator('#rating-progression-card');
    await expect(ratingCard).toBeVisible();
    await expect(ratingCard).toContainText('Architect Rating & Progression');

    const currentRatingEl = page.locator('#profile-current-rating');
    await expect(currentRatingEl).toBeVisible();
    const ratingValue = Number(await currentRatingEl.innerText());
    expect(ratingValue).toBeGreaterThan(1200);

    const svgChart = page.locator('#rating-progression-svg');
    await expect(svgChart).toBeVisible();
    await expect(page.locator('#rating-milestone-readout')).toBeVisible();
  });

  test('verifies calm decluttered Homepage, Guest Sample Run without login, Sheets & Company tracks, and Leaderboard & /u/[uid]', async ({
    page,
  }) => {
    // 1. Calm decluttered Homepage
    await page.goto('/');
    await expect(page.locator('h1')).toContainText(
      'Practice System Design by actually testing your architecture.'
    );
    await expect(page.getByText('Difficulty Progression')).toHaveCount(0);
    await expect(
      page.getByText('Famously Asked System Design Questions')
    ).toHaveCount(0);

    // 2. Guest Sample Run without login
    await page.goto('/problems/url-shortener');
    await expect(page.locator('#guest-sandbox-banner')).toBeVisible();
    await expect(page.locator('#run-sample-btn')).toBeEnabled();
    await page.locator('#insert-writeup-template-btn').click();
    await expect(page.locator('#design-writeup-textarea')).toHaveValue(/### FR-1:/);
    await page.locator('#run-sample-btn').click();
    await expect(page.locator('#test-cases-console')).toContainText(/Sample/i);

    // 3. Sheets & Company SEO Track
    await page.goto('/sheets');
    await expect(page.locator('h1')).toContainText('Curated HLD Sheets');
    await page.goto('/companies/google');
    await expect(page.locator('h1')).toContainText(
      'Google High-Level Design (HLD) Interview Questions'
    );

    // 4. Leaderboard & Shareable Public Profile Card (without GitHub Markdown button)
    await page.goto('/leaderboard');
    await expect(page.locator('#global-leaderboard-table')).toBeVisible();
    await page.goto('/u/dev_arch_aarav');
    await expect(page.locator('#public-architect-dossier')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Copy Profile Link' })
    ).toBeVisible();
    await expect(page.getByText('Copy GitHub Markdown')).toHaveCount(0);
  });

  test('verifies SEO structured data (JSON-LD), dynamic OpenGraph PNGs, manifest, sitemap, and internal links', async ({
    page,
    request,
  }) => {
    // 1. Dynamic OG images + manifest + sitemap
    for (const endpoint of [
      '/opengraph-image',
      '/problems/url-shortener/opengraph-image',
      '/companies/google/opengraph-image',
    ]) {
      const ogRes = await request.get(endpoint);
      expect(ogRes.status()).toBe(200);
      expect(ogRes.headers()['content-type']).toContain('image/png');
    }

    const manifestRes = await request.get('/manifest.webmanifest');
    expect(manifestRes.status()).toBe(200);

    const sitemapRes = await request.get('/sitemap.xml');
    expect(sitemapRes.status()).toBe(200);
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain('/companies/google');
    expect(sitemapXml).not.toContain('/calculator');

    // 2. JSON-LD & dedicated social meta on Problem page + internal mesh links
    await page.goto('/problems/url-shortener');
    const jsonLdRaw = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    expect(jsonLdRaw).toBeTruthy();
    const parsedLd = JSON.parse(jsonLdRaw!);
    expect(JSON.stringify(parsedLd)).toContain('LearningResource');
    expect(JSON.stringify(parsedLd)).toContain('BreadcrumbList');

    await expect(
      page.locator('meta[property="og:title"]')
    ).toHaveAttribute('content', /Design High-Throughput URL Shortener/i);
    await expect(
      page.getByText('Related System Design Questions')
    ).toBeVisible();

    // Company chips are a curated/category match, so they must not be labelled as "asked"
    await expect(page.getByText('Relevant practice for')).toBeVisible();
    await expect(page.getByText('Asked in Interview Loops')).toHaveCount(0);
  });

  test('keeps the header usable on phone-sized screens (nav reachable, no overlapping controls, no sideways scroll)', async ({
    page,
  }) => {
    // Home at 390px: the primary nav is its own full-width row of real, tappable links
    // (the old single-row header squeezed this nav down to a ~14px sliver)
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox!.width).toBeGreaterThan(300);
    for (const label of ['Home', 'Problemset', 'Sheets']) {
      const box = await nav
        .getByRole('link', { name: label, exact: true })
        .boundingBox();
      expect(box, `${label} nav link should render`).not.toBeNull();
      expect(box!.width).toBeGreaterThan(30);
      expect(box!.x).toBeGreaterThanOrEqual(navBox!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        navBox!.x + navBox!.width + 1
      );
    }
    // The last link is reachable by scrolling the nav row sideways
    const rulesLink = nav.getByRole('link', { name: 'Rules', exact: true });
    await rulesLink.scrollIntoViewIfNeeded();
    await expect(rulesLink).toBeInViewport();

    // Home at 360px must not scroll sideways
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    const sidewaysOverflowPx = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(sidewaysOverflowPx).toBeLessThanOrEqual(1);

    // Problem page at 390px: brand, theme, Run, Submit and Sign in must not overlap
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/problems/url-shortener');
    await expect(page.locator('#run-sample-btn')).toBeVisible();
    await expect(page.locator('#google-signin-btn')).toBeVisible();

    // The sticky header must be opaque so scrolled page content never shows through it
    // (`bg-app/95` compiled to no CSS at all, leaving it transparent)
    const headerBackground = await page
      .locator('header')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(headerBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(headerBackground).not.toBe('transparent');

    const headerRects = await page.evaluate(() => {
      const pick = (name: string, el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { name, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return [
        pick('brand', document.querySelector('header a[href="/"]')),
        pick('theme', document.getElementById('theme-toggle-btn')),
        pick('run', document.getElementById('run-sample-btn')),
        pick('submit', document.getElementById('submit-hld-btn')),
        pick('signin', document.getElementById('google-signin-btn')),
      ].filter((r): r is NonNullable<typeof r> => r !== null);
    });
    expect(headerRects).toHaveLength(5);
    for (const r of headerRects) {
      expect(r.left, `${r.name} left edge`).toBeGreaterThanOrEqual(0);
      expect(r.right, `${r.name} right edge`).toBeLessThanOrEqual(390);
    }
    for (let i = 0; i < headerRects.length; i += 1) {
      for (let j = i + 1; j < headerRects.length; j += 1) {
        const a = headerRects[i];
        const b = headerRects[j];
        const overlaps = !(
          a.right <= b.left ||
          b.right <= a.left ||
          a.bottom <= b.top ||
          b.bottom <= a.top
        );
        expect(overlaps, `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });

  test('keeps focus in the name field when a whiteboard box is placed, so the typed name sticks', async ({
    page,
  }) => {
    await page.goto('/problems/url-shortener');
    await expect(page.locator('#run-sample-btn')).toBeEnabled();
    await expect(
      page.getByText('to add a component', { exact: false })
    ).toBeVisible();

    const whiteboard = page.locator('canvas').locator('..');
    const area = await whiteboard.boundingBox();
    expect(area).not.toBeNull();

    await page.getByRole('button', { name: /^Box/ }).click();
    await page.mouse.click(area!.x + 200, area!.y + 120);
    await expect(page.getByPlaceholder('Component name...')).toBeFocused();

    await page.keyboard.type('Redirect Service');
    await page.keyboard.press('Enter');
    await expect(
      whiteboard.getByText('Redirect Service', { exact: true })
    ).toBeVisible();
    // Before the fix the field blurred at once and every new box was named "Service"
    await expect(whiteboard.getByText('Service', { exact: true })).toHaveCount(0);
  });

  test('keeps a guest draft across two reloads and in a new tab', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const draftText = 'Guest draft that must survive a reload.';

    await page.goto('/problems/url-shortener');
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    await expect(
      page.getByText('to add a component', { exact: false })
    ).toBeVisible();

    const whiteboard = page.locator('canvas').locator('..');
    const area = await whiteboard.boundingBox();
    expect(area).not.toBeNull();
    await page.getByRole('button', { name: /^Box/ }).click();
    await page.mouse.click(area!.x + 200, area!.y + 120);
    await expect(page.getByPlaceholder('Component name...')).toBeFocused();
    await page.keyboard.type('Sticky Cache');
    await page.keyboard.press('Enter');

    const writeup = page.locator('#design-writeup-textarea');
    await writeup.fill(draftText);

    // The live counter under the write-up is a rough keyword check, labelled as such
    await expect(page.locator('#writeup-fr-mentions')).toContainText(
      'FRs mentioned:'
    );

    // Two reloads in a row. The second one used to come back empty: the guest
    // draft was deleted from storage every time the page finished loading.
    for (let i = 0; i < 2; i += 1) {
      await page.reload();
      await expect(page.locator('#google-signin-btn')).toBeVisible();
      await expect(writeup).toHaveValue(draftText);
      await expect(
        whiteboard.getByText('Sticky Cache', { exact: true })
      ).toBeVisible();
    }

    // A new tab in the same browser (a guest draft is no longer tied to one tab)
    const secondTab = await context.newPage();
    await secondTab.goto('/problems/url-shortener');
    await expect(secondTab.locator('#google-signin-btn')).toBeVisible();
    await expect(secondTab.locator('#design-writeup-textarea')).toHaveValue(
      draftText
    );
  });

  test('carries a guest draft into the account on sign-in and leaves a clean workspace on sign-out', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const draftText = 'Written as a guest, then signed in to submit.';

    await page.goto('/problems/url-shortener');
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    const writeup = page.locator('#design-writeup-textarea');
    await writeup.fill(draftText);

    // A guest cannot submit: the button is disabled and hovering it says why
    const submit = page.locator('#submit-hld-btn');
    await expect(submit).toBeDisabled();
    await expect(page.locator('#submit-signin-hint')).toBeHidden();
    await submit.hover({ force: true });
    await expect(page.locator('#submit-signin-hint')).toBeVisible();
    await expect(page.locator('#submit-signin-hint')).toHaveText(
      'Sign in to submit'
    );
    // Run stays available to guests
    await expect(page.locator('#run-sample-btn')).toBeEnabled();

    // Signing in keeps what is on screen ("your guest draft carries over")
    await page.locator('#dummy-signin-btn').click();
    await expect(page.locator('#account-menu-btn')).toBeVisible();
    await expect(writeup).toHaveValue(draftText);
    await expect(submit).toBeEnabled();
    await expect(page.locator('#submit-signin-hint')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#account-menu-btn')).toBeVisible();
    await expect(writeup).toHaveValue(draftText);

    // Signing out leaves a clean guest workspace: neither the account's draft nor
    // the old guest copy is shown
    await page.locator('#account-menu-btn').click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    await expect(writeup).toHaveValue('');
    await page.reload();
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    await expect(writeup).toHaveValue('');
  });

  test('suggests turning a phone sideways on problem pages and frees the header in landscape', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/problems/url-shortener');
    await expect(page.locator('#google-signin-btn')).toBeVisible();

    const hint = page.locator('#rotate-device-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Turn your phone sideways');

    // Sideways: no hint, a wide whiteboard, and the header scrolls away with the
    // page instead of taking a quarter of a 390px-tall screen
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(hint).toBeHidden();
    const headerPosition = await page
      .locator('header')
      .first()
      .evaluate((el) => getComputedStyle(el).position);
    expect(headerPosition).toBe('relative');
    const boardWidth = await page
      .locator('canvas')
      .locator('..')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(boardWidth).toBeGreaterThan(800);

    // Desktop never sees the hint, and keeps its sticky header
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(hint).toBeHidden();
    expect(
      await page
        .locator('header')
        .first()
        .evaluate((el) => getComputedStyle(el).position)
    ).toBe('sticky');

    // Upright again: dismissing it sticks across a reload
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(hint).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss rotate hint' }).click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    await expect(page.locator('#rotate-device-hint')).toHaveCount(0);
  });

  test('verifies server-rendered /community/[postId] pages, DiscussionForumPosting JSON-LD, OG image, and anti-spoiler solution lock', async ({
    page,
    request,
  }) => {
    // 1. Crawl-friendly <a href="/community/..."> links on /community
    await page.goto('/community');
    const expLink = page.locator('a[href="/community/dev_exp_google_l5"]');
    await expect(expLink).toBeVisible();

    // 2. Public Interview Experience page renders full article, replies, Share Link, & DiscussionForumPosting JSON-LD
    await expLink.click();
    await expect(page).toHaveURL(/\/community\/dev_exp_google_l5$/, {
      timeout: 15000,
    });
    await expect(page.locator('#community-post-article h1')).toContainText(
      'Google L5 System Design Experience'
    );
    await expect(page.locator('#copy-community-post-link-btn')).toBeVisible();
    await expect(page.locator('#community-post-article')).toContainText(
      'Round Overview (45 mins)'
    );

    const postJsonLd = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    expect(postJsonLd).toContain('DiscussionForumPosting');

    const postOgRes = await request.get(
      '/community/dev_exp_google_l5/opengraph-image'
    );
    expect(postOgRes.status()).toBe(200);
    expect(postOgRes.headers()['content-type']).toContain('image/png');

    // 3. Solution post at /community/[postId] enforces anti-spoiler lock + noindex
    await page.goto('/community/dev_sol_url_shortener');
    await expect(page.locator('#solution-anti-spoiler-lock')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/i
    );
  });

  test('shows a community post pageless: no card around it, as wide as the header, no sideways scroll on phones', async ({
    page,
  }) => {
    const sidewaysOverflowPx = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );

    // Desktop: the post sits on the page background (no bordered card) and lines
    // up with the header instead of living in a narrow centred column
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/community/dev_exp_google_l5');
    const article = page.locator('#community-post-article');
    await expect(article.locator('h1')).toBeVisible();
    const layout = await article.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const brand = document
        .querySelector('header a[href="/"]')!
        .getBoundingClientRect();
      return {
        borderWidth: style.borderTopWidth,
        background: style.backgroundColor,
        padding: style.paddingLeft,
        left: rect.left,
        width: rect.width,
        brandLeft: brand.left,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(layout.borderWidth).toBe('0px');
    expect(layout.background).toBe('rgba(0, 0, 0, 0)');
    expect(layout.padding).toBe('0px');
    expect(Math.abs(layout.left - layout.brandLeft)).toBeLessThanOrEqual(1);
    expect(layout.width).toBeGreaterThan(layout.viewportWidth * 0.9);

    // Phones: a solution post has the widest header chip (problem code + title).
    // It used to push the whole page sideways at 390px and below.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 780 });
      await page.goto('/community/dev_sol_url_shortener');
      await expect(page.locator('#solution-anti-spoiler-lock')).toBeVisible();
      await expect(page.locator('#google-signin-btn')).toBeVisible();
      expect(
        await sidewaysOverflowPx(),
        `sideways scroll at ${width}px`
      ).toBeLessThanOrEqual(1);
    }

    // Signed in at 320px: the reply box and its button fit the screen
    // (the Reply button used to stick out past the right edge)
    await page.goto('/community/dev_exp_google_l5?dummy=1');
    await expect(page.locator('#account-menu-btn')).toBeVisible();
    const replyButton = page.getByRole('button', { name: 'Reply', exact: true });
    await expect(replyButton).toBeVisible();
    const replyBox = await replyButton.boundingBox();
    expect(replyBox).not.toBeNull();
    expect(replyBox!.x + replyBox!.width).toBeLessThanOrEqual(320);
    expect(await sidewaysOverflowPx()).toBeLessThanOrEqual(1);
  });

  test('says the homepage is free and explains how scoring works and what it cannot judge, with a link to /rules', async ({
    page,
  }) => {
    await page.goto('/');

    // "Free" is the first thing the homepage says
    await expect(page.locator('main')).toContainText(
      /free system design practice/i
    );

    const scoring = page.locator('#how-scoring-works');
    await expect(scoring.getByRole('heading', { level: 2 })).toHaveText(
      'How scoring works, and what it cannot judge'
    );
    await expect(
      scoring.getByRole('heading', { name: 'How a submission is scored' })
    ).toBeVisible();
    await expect(
      scoring.getByRole('heading', { name: 'What it cannot judge', exact: true })
    ).toBeVisible();

    // The limit a sceptic will look for is stated plainly, not buried
    await expect(scoring).toContainText('pattern matching, not understanding');
    // Numbers quoted here are checked against the engine by publicJudgeFacts.test.ts
    await expect(scoring).toContainText('4 of the 7 are hidden');
    await expect(scoring).toContainText('60% write-up, 40% simulation');

    // Phone: the two columns stack under each other and nothing scrolls sideways
    await page.setViewportSize({ width: 320, height: 640 });
    await scoring.scrollIntoViewIfNeeded();
    const columns = await scoring.evaluate((el) => {
      const [scored, limits] = Array.from(el.querySelectorAll('h3')).map((h) =>
        h.parentElement!.getBoundingClientRect()
      );
      return {
        stacked: limits.top >= scored.bottom,
        sidewaysOverflowPx:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    expect(columns.stacked).toBe(true);
    expect(columns.sidewaysOverflowPx).toBeLessThanOrEqual(1);

    // The section sends people to the full rulebook
    await scoring.getByRole('link', { name: /Full rules/ }).click();
    await expect(page).toHaveURL(/\/rules$/, { timeout: 15000 });
    await expect(page.locator('#rulebook-heading')).toBeVisible();
  });
});
