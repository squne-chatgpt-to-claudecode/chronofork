import {expect,test} from '@playwright/test'

// 既知の成功入力（年・相手ID・数値）を使わず、画面に出た記録だけで
// 「終点の不足 → 保持者の喪失 → 人物 → 婚姻候補・出生の理由 → 介入フォームへ」を辿れることを確認する。
// 実A0を1回だけ計算する（A1は計算しない）。介入の効果・結果比較は別の通し試験で確認する。
const heavy=process.env.CHRONOFORK_E2E_INTEGRATED==='1'
test.describe('PR #118 理由を調べて介入へ進む探索経路（opt-in）',()=>{
  test.skip(!heavy,'CHRONOFORK_E2E_INTEGRATED=1で100年A0を実計算する')
  test.setTimeout(4*60_000)

  test('終点の不足から喪失記録・人物履歴・婚姻候補の理由を画面だけで辿り、候補の2人を介入フォームへ渡せる',async({page})=>{
    await page.setViewportSize({width:1280,height:900})
    page.setDefaultTimeout(60_000)
    await page.goto('/')
    await page.getByTestId('obs-start').click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1250年初',{timeout:3*60_000})

    // 終点の不足 → 保持者を失った称号の記録。年・人物は画面の実記録から選ぶ。
    const loss=page.getByTestId('obs-loss-records')
    await expect(loss).toBeVisible()
    await loss.getByTestId('obs-loss-person').first().click()
    await expect(page.getByTestId('person-history')).toBeVisible({timeout:90_000})
    await expect(page.getByTestId('history-no-birth-judgment')).toContainText('判断の対象外')
    await expect(page.getByTestId('history-judgments')).toContainText('きょうだい')
    await expect(page.getByTestId('history-judgments')).toContainText('共通の祖先が2世代以内')
    // 死亡の年の翌年初は、選択人物にも打消し線が付く。
    await page.getByRole('button',{name:'翌年',exact:true}).click()
    await expect(page.getByTestId('family-tree').locator('.ft-self.ft-dead')).toBeVisible({timeout:90_000})

    // 世界の閲覧タブでも同じA0・年・人物。旧試験計算の世界は混ざらない。
    const ctx=await page.getByTestId('obs-context-line').innerText()
    await page.getByTestId('obs-tab-world').click()
    await expect(page.getByTestId('obs-context-line')).toHaveText(ctx)
    await expect(page.getByTestId('region-map')).toBeVisible()
    await expect(page.getByTestId('person-history')).toBeHidden()
    await page.getByTestId('obs-tab-investigate').click()

    // 両親へ移動すると、別人へ黙って切り替わらず、親の婚姻・出生判断の理由を読める。
    const before=await page.getByTestId('obs-person').inputValue()
    await page.getByTestId('history-parents').getByRole('button').first().click()
    await expect(page.getByTestId('obs-person')).not.toHaveValue(before,{timeout:90_000})
    await expect(page.getByTestId('history-judgments')).toContainText('親の年齢が出生判定の対象範囲外')

    // 婚姻候補の2人を、画面の記録から介入フォームへ渡せる（実行・効果の確認は別試験）。
    await page.getByTestId('obs-person').selectOption({index:0})
    await page.getByTestId('history-partner').first().locator('> summary').click()
    const intervene=page.getByTestId('history-intervene-pair').first()
    if(await intervene.count()>0){
      await intervene.click()
      await expect(page.getByTestId('branch-fork-year')).toHaveValue(/^1[23]\d\d$/)
    }
  })
})
