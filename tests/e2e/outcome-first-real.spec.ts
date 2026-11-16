import {expect,test} from '@playwright/test'

// 正式シナリオの成功や履歴を捏造しない。実A0の100年計算を明示したときだけ実行。
test.describe('結末から遡るMVPの原史探索（opt-in実世界）',()=>{
  test.skip(process.env.CHRONOFORK_E2E_INTEGRATED!=='1',
    'CHRONOFORK_E2E_INTEGRATED=1 の場合だけ100年A0を実計算する')
  test.setTimeout(15*60_000)

  test('1350年目的→称号の変遷→変化年→Eventと実人物名を探せる',async({page})=>{
    await page.setViewportSize({width:1280,height:900})
    await page.goto('/')
    await expect(page.getByTestId('experimental-banner')).toBeHidden()
    await page.getByTestId('obs-start').click()
    await expect(page.getByTestId('obs-goal')).toBeVisible({timeout:12*60_000})
    await expect(page.getByTestId('obs-goal')).toContainText('ナルヴェン家の世襲領地')
    await expect(page.getByTestId('obs-title-timeline')).toBeVisible()
    await expect(page.getByTestId('obs-title-timeline')).toContainText('1350年初')
    const cards=page.getByTestId('obs-title-timeline').locator('.obs-title-index-card')
    expect(await cards.count()).toBeGreaterThanOrEqual(2)
    const jump=page.getByTestId('obs-title-timeline').locator('button[data-testid^="obs-title-turning-"]').first()
    await expect(jump).toBeVisible()
    const year=Number((await jump.innerText()).match(/(\d{4})年/)?.[1])
    expect(year).toBeGreaterThanOrEqual(1250)
    expect(year).toBeLessThan(1350)
    await jump.click()
    await expect(page.getByTestId('obs-year-label')).toContainText(year+'年初',{timeout:90_000})
    await expect(page.getByTestId('obs-title-detail')).toBeVisible()
    const chronicle=page.getByTestId('obs-title-chronicle')
    await chronicle.locator('summary').click()
    await expect(chronicle).toContainText('年の記録へ')

    // 同年出生の実Eventを名前解決し、長大な自動生成IDを表へ露出させない。
    await page.getByText('すべての年の記録件数を見る（Event・Trace）').click()
    await page.getByRole('button',{name:/^1252年・事件/}).click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1252年初',{timeout:90_000})
    await page.getByTestId('obs-event-type').selectOption('LEGAL_DYNASTY_SET')
    const first=page.getByTestId('obs-event-list').locator('button').first()
    await expect(first).toBeVisible()
    await expect(first).not.toContainText('person:b002:auto:')
    await expect(first).not.toContainText('参照不明')
    await expect(page.getByTestId('obs-goal')).toContainText('正式勝敗：未成立')
  })
})
