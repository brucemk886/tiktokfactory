export const TASK_GROUP_ROLES = Object.freeze({
 review:{label:'内容评审组',action:'稳定中强账号固定文案、样式和修订，补齐五个不同账号的满72小时基线。'},
 strong:{label:'强号产出组',action:'优胜内容保产出，按每周配额少量优化验证和探索。'},
 normal:{label:'中号产出组',action:'优胜内容为主，按每周配额验证优化与潜力内容。'},
 'rescue-hook':{label:'首图救援组',action:'用成熟优胜内容作基准，单独验证首图和标题；不冷探索。'},
 'rescue-content':{label:'内页救援组',action:'用成熟优胜内容作基准，单独验证内页表达和页序；不冷探索。'},
 diagnostic:{label:'近零诊断组',action:'检查状态与回执，最多六条基准后等待满72小时效果复查。'},
 observing:{label:'待观察组',action:'已有观察但成熟样本不足；合格基准不足时等待，不强行补量。'},
 launch:{label:'新号起量组',action:'新纳管账号从已验证内容起量，合格基准不足时等待；不把新号当稳定评审账号。'},
});
export const TASK_GROUP_POLICY = Object.freeze({cycleDays:7,reviewDays:3,maxReviewAccounts:60,pageSize:20});
// Preserve already selected stable reviewers before admitting deterministic replacements.
export function assignTaskGroupRoles(accounts, {reviewTarget=60,previousReview=new Set()}={}) {
 if(!Number.isInteger(reviewTarget)||reviewTarget<5||reviewTarget>60)throw new RangeError('评审目标应为5–60个账号。');
 const eligible=accounts.filter(a=>!a.paused&&!a.blocked&&['strong','normal'].includes(a.accountPool)&&Number(a.n)>=5);
 eligible.sort((a,b)=>Number(previousReview.has(b.connectionId))-Number(previousReview.has(a.connectionId))
  ||Number(b.accountPool==='strong')-Number(a.accountPool==='strong')||a.connectionId.localeCompare(b.connectionId));
 const reviewers=new Set(eligible.slice(0,reviewTarget).map(a=>a.connectionId));
 return accounts.map(a=>({...a,role:reviewers.has(a.connectionId)?'review':a.accountPool==='observing'?(a.isNew?'launch':'observing'):a.accountPool}));
}
