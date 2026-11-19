const form = document.querySelector('#login');
const submit = document.querySelector('#submit');
const result = document.querySelector('#result');
const statusLine = document.querySelector('#status');
function clearIdentity() {
    result.hidden = true;
    for (const id of ['reader', 'current', 'session']) document.getElementById(id).textContent = '';
}
form.addEventListener('input', () => { clearIdentity(); statusLine.textContent = ''; });
form.addEventListener('submit', async event => {
    event.preventDefault();
    clearIdentity();
    const {username, password} = form.elements;
    submit.disabled = username.disabled = password.disabled = true;
    statusLine.textContent = '正在登录…';
    try {
        const login = await fetch('/auth/login', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({username:username.value.trim(), password:password.value})
        });
        password.value = '';
        if (!login.ok) throw new Error(login.status === 401 ? '账号或密码不正确，或账号已停用。' : '身份服务暂时无法登录，请检查数据库连接。');
        const {accessToken} = await login.json();
        statusLine.textContent = '正在查询借阅服务的数据库会话…';
        const response = await fetch('/demo/loan-identity', {
            cache:'no-store', headers:{Authorization:'Bearer ' + accessToken}
        });
        if (!response.ok) throw new Error(response.status === 403 ? '登录成功，该账号没有借阅权限。' : '登录成功，未能获取借阅数据库会话。请检查借阅服务和数据库连接。');
        const me = await response.json();
        if (!me.database?.current_user || !me.database?.session_user)
            throw new Error('借阅服务没有返回完整的数据库会话信息。');
        document.querySelector('#reader').textContent = me.username;
        document.querySelector('#current').textContent = me.database.current_user;
        document.querySelector('#session').textContent = me.database.session_user;
        result.hidden = false;
        statusLine.textContent = '查询成功。';
    } catch (error) {
        statusLine.textContent = error instanceof TypeError ? '连接失败，请确认服务已启动。' : error.message;
    } finally {
        password.value = '';
        submit.disabled = username.disabled = password.disabled = false;
    }
});
