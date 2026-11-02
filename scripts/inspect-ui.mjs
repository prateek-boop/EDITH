import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
await page.goto('http://127.0.0.1:5173');await page.screenshot({path:'/tmp/edith-auth.png'});await page.getByRole('button',{name:'Continue in local demo mode',exact:true}).click();await page.locator('.recent-row').first().click();await page.waitForTimeout(2400);await page.screenshot({path:'/tmp/edith-agent.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/edith-mobile.png'});
for (const view of ['Workspace','Graph','Memory','Activity']) {
  await page.getByRole('button',{name:view,exact:true}).click();await page.locator('.view-loader').waitFor({state:'hidden',timeout:30000});await page.waitForTimeout(500);await page.screenshot({path:`/tmp/edith-${view.toLowerCase()}-mobile.png`});
  const {violations} = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  if(violations.length) throw new Error(JSON.stringify(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
  console.log(`${view}: mobile accessibility passed`);
}
await browser.close();
