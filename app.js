import { ethers } from 'ethers';
import { AppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';

const PROJECT_ID = 'f018499b1e4a94d961ab67aeeeff3254';

const botTestnet = {
  id: 968,
  name: 'BOT Chain Testnet',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.bohr.life'] } },
  blockExplorers: { default: { name: 'BOTScan Testnet', url: 'https://scan.bohr.life' } },
  testnet: true,
};
const botMainnet = {
  id: 677,
  name: 'BOT Chain',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.botchain.ai'] } },
  blockExplorers: { default: { name: 'BOTScan', url: 'https://scan.botchain.ai' } },
};

const NW_ABI = [
  'function totalJobs() view returns (uint256)',
  'function totalRewarded() view returns (uint256)',
  'function postJob(string,uint256,uint32)',
  'function claimJob(uint256)',
  'function submitJob(uint256,string)',
  'function approveJob(uint256)',
  'function disputeJob(uint256)',
  'function resolveDispute(uint256,bool)',
  'function timeoutSettle(uint256)',
  'function cancelJob(uint256)',
  'function getJob(uint256) view returns (address,string,uint256,uint32,address,string,uint8,uint64,uint64)',
  'function completedJobs(address) view returns (uint256)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function deposit() payable',
  'function allowance(address,address) view returns (uint256)',
];

const CONTRACTS = {
  968: {
    nw: '0x13C675A6400CB17C7a3cEED03B7985adb2a4984B',
    wbot: '0xD8FBaBf44B2dbb427d881F8Ea66F14D8287A55c0',
  },
  677: {
    nw: '0x8Df96d6721196161a953b45da114a7BA8193E5B2',
    wbot: '0xD5452816194a3784dBa983426cCe7c122F4abd30',
  },
};

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 18) => Number(ethers.formatUnits(n, d)).toLocaleString(undefined, { maximumFractionDigits: 4 });
const short = (a) => (a && a !== ethers.ZeroAddress) ? a.slice(0, 6) + '…' + a.slice(-4) : '—';

function getProvider() {
  try {
    if (typeof appkit !== 'undefined' && appkit && typeof appkit.getWalletProvider === 'function') {
      const p = appkit.getWalletProvider('eip155') || appkit.getWalletProvider();
      if (p) return p;
    }
  } catch (e) {}
  return null;
}
async function getSigner() {
  const wp = getProvider();
  if (!wp) { try { appkit.open(); } catch (e) {} return null; }
  return new ethers.BrowserProvider(wp).getSigner();
}
const JOB_STATE = ['open', 'claimed', 'submitted', 'paid', 'cancelled', 'disputed'];

let appkit = null;
let readProvider;
let currentChainId = 677;
let account = null;

function initAppKit() {
  if (!$('connectBtn')) return;
  const adapter = new EthersAdapter();
  appkit = new AppKit({
    networks: [botMainnet, botTestnet],
    adapters: [adapter],
    projectId: PROJECT_ID,
    themeMode: 'dark',
    metadata: { name: 'NodeWorks', description: 'DePIN compute bounties on BOT Chain', url: location.origin, icons: [] },
  });
  appkit.subscribeAccount((state) => {
    account = state.address || null;
    $('connectBtn').textContent = account ? short(account) : 'Connect wallet';
    refresh();
  });
  $('connectBtn').addEventListener('click', () => appkit.open());
  if ($('netSel')) {
    $('netSel').addEventListener('change', (e) => {
      currentChainId = Number(e.target.value);
      refresh();
    });
  }
}

function contract() {
  const c = CONTRACTS[currentChainId];
  if (!c) return null;
  return new ethers.Contract(c.nw, NW_ABI, readProvider);
}

async function signerOrAlert() {
  if (!account) { appkit?.open(); return null; }
  if (!CONTRACTS[currentChainId]) { alert('No contracts on this network. Switch to BOT Chain 677 or Testnet 968.'); return null; }
  const s = await getSigner();
  if (!s) { appkit?.open(); return null; }
  return s;
}

async function ensureAllowance(spender, amount) {
  const s = await signerOrAlert();
  if (!s) return false;
  const c = CONTRACTS[currentChainId];
  const token = new ethers.Contract(c.wbot, ERC20_ABI, s);
  const owner = await s.getAddress();
  const allow = await token.allowance(owner, spender);
  if (allow >= amount) return true;
  const tx = await token.approve(spender, ethers.MaxUint256, { gasPrice: ethers.parseUnits('20', 'gwei'), gasLimit: 600000n });
  await tx.wait();
  return true;
}

async function refresh() {
  const nw = contract();
  if (!nw) return;
  try {
    if ($('stJobs')) {
      const [jobs, rewarded] = await Promise.all([nw.totalJobs(), nw.totalRewarded()]);
      $('stJobs').textContent = String(jobs);
      $('stRewarded').textContent = fmt(rewarded);
    }
    if ($('jobList')) await renderJobs(nw);
    if ($('wkOut')) await renderWorker(nw);
  } catch (e) {
    console.error(e);
  }
}

async function renderJobs(nw) {
  const total = await nw.totalJobs();
  let html = '';
  for (let i = 0n; i < total; i++) {
    const j = await nw.getJob(i);
    const [poster, spec, reward, deadline, worker, result, state, claimedAt, submittedAt] = j;
    const active = Number(state) <= 2;
    html += `<div class="item">
      <div><b>#${i}</b> ${spec.length > 38 ? spec.slice(0, 36) + '…' : spec} · <span class="tag">${JOB_STATE[state] ?? state}</span></div>
      <div class="mono">${fmt(reward)} WBOT · deadline ${deadline}h · poster ${short(poster)}</div>
      <div class="mono">${worker && worker !== ethers.ZeroAddress ? 'worker ' + short(worker) : 'unclaimed'}${result ? ' · result ' + (result.length > 30 ? result.slice(0, 28) + '…' : result) : ''}</div>
    </div>`;
  }
  $('jobList').innerHTML = html || '<div class="empty">No jobs posted yet — post the first bounty.</div>';
}

async function renderWorker(nw) {
  const addr = $('wkAddr').value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { $('wkOut').innerHTML = '<div class="empty">Enter a 0x… address.</div>'; return; }
  const done = await nw.completedJobs(addr);
  $('wkOut').innerHTML = `<div class="item"><div><b>Worker record</b></div><div class="mono">completed jobs: ${done}</div></div>`;
}

async function doAction(method, args, msgId, needsValue) {
  const s = await signerOrAlert();
  if (!s) return;
  const c = CONTRACTS[currentChainId];
  if (needsValue && !(await ensureWbot(needsValue, 'actMsg'))) return;
  if (needsValue && !(await ensureAllowance(c.nw, needsValue))) return;
  const nw = new ethers.Contract(c.nw, NW_ABI, s);
  const tx = await nw[method](...args, { gasPrice: ethers.parseUnits('20', 'gwei'), gasLimit: 600000n });
  await tx.wait();
  showMsg(msgId, 'done');
  refresh();
}

async function ensureWbot(amount, msgId) {
  const s = await signerOrAlert();
  if (!s) return false;
  const c = CONTRACTS[currentChainId];
  const w = new ethers.Contract(c.wbot, ERC20_ABI, s);
  const owner = await s.getAddress();
  const bal = await w.balanceOf(owner);
  if (bal >= amount) return true;
  const shortfall = amount - bal;
  const native = await s.provider.getBalance(owner);
  const gasCost = ethers.parseUnits('0.005', 18);
  if (native < shortfall + gasCost) {
    showMsg(msgId, 'Need ' + fmt(shortfall + gasCost - native) + ' more BOT — fund the wallet first (wrap + gas).');
    return false;
  }
  showMsg(msgId, 'Wrapping BOT → WBOT…');
  const tx = await w.deposit({ value: shortfall });
  await tx.wait();
  return true;
}

function showMsg(id, msg) {
  const el = $(id);
  if (el) { el.textContent = msg; setTimeout(() => (el.textContent = ''), 6000); }
}

function boot() {
  initAppKit();
  readProvider = new ethers.JsonRpcProvider(currentChainId === 677 ? 'https://rpc.botchain.ai' : 'https://rpc.bohr.life');
  if ($('postBtn')) $('postBtn').addEventListener('click', () => {
    const spec = $('postSpec').value.trim();
    const reward = $('postReward').value.trim();
    const hours = $('postHours').value.trim() || '24';
    if (!spec || !reward || Number(reward) <= 0) return showMsg('postMsg', 'spec + reward required');
    doAction('postJob', [spec, ethers.parseEther(reward), Number(hours)], 'postMsg', ethers.parseEther(reward)).catch((e) => showMsg('postMsg', e.shortMessage || 'failed'));
  });
  if ($('claimBtn')) $('claimBtn').addEventListener('click', () => {
    const id = $('actId').value.trim();
    if (id === '') return showMsg('actMsg', 'job id required');
    doAction('claimJob', [id], 'actMsg').catch((e) => showMsg('actMsg', e.shortMessage || 'failed'));
  });
  if ($('subBtn')) $('subBtn').addEventListener('click', () => {
    const id = $('actId').value.trim();
    const res = $('actResult').value.trim();
    if (id === '' || !res) return showMsg('actMsg', 'job id + result URI required');
    doAction('submitJob', [id, res], 'actMsg').catch((e) => showMsg('actMsg', e.shortMessage || 'failed'));
  });
  if ($('appBtn')) $('appBtn').addEventListener('click', () => {
    const id = $('actId').value.trim();
    if (id === '') return showMsg('actMsg', 'job id required');
    doAction('approveJob', [id], 'actMsg').catch((e) => showMsg('actMsg', e.shortMessage || 'failed'));
  });
  if ($('disBtn')) $('disBtn').addEventListener('click', () => {
    const id = $('actId').value.trim();
    if (id === '') return showMsg('actMsg', 'job id required');
    doAction('disputeJob', [id], 'actMsg').catch((e) => showMsg('actMsg', e.shortMessage || 'failed'));
  });
  if ($('wkBtn')) $('wkBtn').addEventListener('click', () => renderWorker(contract()).catch(() => {}));
  refresh();
}
boot();
