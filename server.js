<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover" />
    <title>LexnaVe - Premium Legal AI</title>
    <!-- Supabase JS Client -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-deep: #020408;
            --bg-metal: radial-gradient(circle at 50% 50%, #000c24, #000510);
            --gold-shine: linear-gradient(135deg, #BF953F, #FCF6BA, #B38728, #FBF5B7, #AA771C);
            --glow-gold: 0 0 15px rgba(212, 175, 55, 0.4);
            --font-luxury: 'Playfair Display', serif;
            --font-ui: 'Cormorant', serif;
            --sidebar-width: 280px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; outline: none; }
        body { 
            background-color: var(--bg-deep);
            background-image: var(--bg-metal);
            font-family: var(--font-ui);
            color: #fff;
            min-height: 100vh;
            overflow-x: hidden;
        }
        .text-gold {
            background: var(--gold-shine);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            text-shadow: 0px 2px 10px rgba(212, 175, 55, 0.2);
            font-family: var(--font-luxury);
            letter-spacing: 3px;
        }
        
        /* --- LOGIN STYLES --- */
        .login-container {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            padding-top: 20px;
            padding-left: 20px;
            padding-right: 20px;
        }
        .logo-area { text-align: center; margin-bottom: 40px; position: relative; }
        .flag-metal {
            width: 100px; height: 60px;
            border-radius: 8px;
            overflow: hidden;
            border: 2px solid #D4AF37;
            box-shadow: var(--glow-gold);
            margin: 0 auto 20px;
            position: relative;
        }
        .flag-metal::before {
            content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%;
            background: linear-gradient(to right, transparent, rgba(255,255,255,0.4), transparent);
            transform: skewX(-25deg);
            animation: shine 3s infinite;
        }
        @keyframes shine { 100% { left: 150%; } }
        .flag-strip { height: 33.33%; width: 100%; display: block; }
        .yellow { background: linear-gradient(to bottom, #FFD700, #B8942E); }
        .blue { background: linear-gradient(to bottom, #000c24, #000510); display: flex; align-items: center; justify-content: center; gap: 2px; }
        .red { background: linear-gradient(to bottom, #CE1126, #8a0c1a); }
        .star { color: #fff; font-size: 8px; text-shadow: 0 0 5px #fff; display: inline-block; }
        
        .btn-gold {
            width: 100%; max-width: 380px;
            padding: 16px;
            border: none;
            border-radius: 12px;
            background: var(--gold-shine);
            color: #050A1A;
            font-family: var(--font-luxury);
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 5px 15px rgba(0,0,0,0.4);
            transition: 0.5s;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .form-group { width: 100%; max-width: 380px; margin: 0 auto 20px; }
        .form-group input { 
            width: 100%; padding: 15px 20px; 
            background: rgba(0,0,0,0.4); 
            border: 1px solid rgba(212, 175, 55, 0.3); 
            border-radius: 12px; 
            color: #FFF0A8; 
            font-family: var(--font-ui);
            font-size: 20px;
        }
        .error-msg { color: #ff4d4d; text-align: center; margin-top: 10px; font-size: 16px; min-height: 20px; }

        /* --- CHAT & SIDEBAR LAYOUT --- */
        .main-layout { display: flex; height: 100vh; width: 100vw; }
        
        /* Sidebar Styles */
        .sidebar {
            width: var(--sidebar-width);
            background: rgba(2, 4, 8, 0.95);
            border-right: 1px solid rgba(212, 175, 55, 0.2);
            display: flex;
            flex-direction: column;
            padding: 20px 10px;
            transition: transform 0.3s ease;
            z-index: 100;
        }
        .new-chat-btn {
            width: 100%; padding: 12px; margin-bottom: 20px;
            background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.4);
            border-radius: 10px; color: #D4AF37; font-family: var(--font-ui); font-size: 18px;
            cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
            transition: all 0.3s;
        }
        .new-chat-btn:hover { background: rgba(212, 175, 55, 0.2); box-shadow: var(--glow-gold); }
        
        .history-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .history-item {
            padding: 12px; border-radius: 8px; cursor: pointer;
            border: 1px solid transparent; color: #aaa; font-size: 16px;
            display: flex; justify-content: space-between; align-items: center;
            transition: all 0.2s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .history-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
        .history-item.active { 
            background: rgba(212, 175, 55, 0.15); border-color: rgba(212, 175, 55, 0.5); 
            color: #D4AF37; font-weight: 600; 
        }
        .delete-session { 
            opacity: 0; color: #ff4d4d; font-size: 14px; padding: 4px; 
            transition: opacity 0.2s; 
        }
        .history-item:hover .delete-session { opacity: 1; }

        /* Chat Area Styles */
        .chat-wrapper { flex: 1; display: flex; flex-direction: column; position: relative; }
        .chat-header { 
            text-align: center; padding: 15px; 
            border-bottom: 1px solid rgba(212, 175, 55, 0.3); 
            display: flex; align-items: center; justify-content: center; position: relative;
        }
        .menu-toggle {
            position: absolute; left: 15px; top: 50%; transform: translateY(-50%);
            background: none; border: none; color: #D4AF37; font-size: 24px; cursor: pointer;
            display: none; /* Hidden on desktop */
        }
        .chat-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px; }
        
        .user-message { 
            align-self: flex-end; background: #0a1628; border: 1px solid rgba(212, 175, 55, 0.3); 
            padding: 12px 18px; border-radius: 18px; max-width: 80%; color: #FFF0A8; 
            font-family: var(--font-ui); font-size: 20px; 
        }
        .bot-message { 
            align-self: flex-start; background: #050a14; border: 1px solid rgba(212, 175, 55, 0.4); 
            padding: 12px 18px; border-radius: 18px; max-width: 80%; color: #D4AF37; 
            line-height: 1.5; white-space: pre-wrap; font-family: var(--font-ui); font-size: 20px; 
        }
        
        .chat-input-area { display: flex; padding: 20px; gap: 12px; border-top: 1px solid rgba(212, 175, 55, 0.3); }
        .chat-input-area input { 
            flex: 1; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(212, 175, 55, 0.3); 
            border-radius: 30px; color: #FFF0A8; font-family: var(--font-ui); font-size: 20px; 
        }
        .chat-input-area button { width: 50px; background: var(--gold-shine); border: none; border-radius: 50%; cursor: pointer; font-size: 20px; }
        .loader { text-align: center; padding: 10px; color: #D4AF37; display: none; font-family: var(--font-ui); }
        .logout-btn {
            position: absolute; right: 15px; top: 50%; transform: translateY(-50%);
            background: var(--gold-shine); border: none; border-radius: 8px;
            width: 36px; height: 36px; cursor: pointer; font-size: 18px;
            display: flex; align-items: center; justify-content: center;
        }

        /* Mobile Responsiveness */
        @media (max-width: 768px) {
            .sidebar { position: fixed; height: 100%; transform: translateX(-100%); }
            .sidebar.open { transform: translateX(0); box-shadow: 5px 0 20px rgba(0,0,0,0.8); }
            .menu-toggle { display: block; }
            .user-message, .bot-message { max-width: 90%; font-size: 18px; }
            .logo-area h1 { font-size: 2rem !important; }
        }
    </style>
</head>
<body>
<div id="app"></div>

<script>
    // ⚠️ REEMPLAZA ESTOS VALORES CON LOS DE TU PROYECTO SUPABASE
    const SUPABASE_URL = "https://dhcacnfuummsgpxujpjz.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_pIYUap3GDuL7xqwP0CCCWA_WrUPp1aN"; 
    
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const BACKEND_URL = "https://lexnave-backend.onrender.com";
    
    let currentSessionId = null;
    let isMobile = window.innerWidth <= 768;

    // --- API FUNCTIONS CON TOKEN JWT ---
    async function buscarEnBackend(pregunta, sessionId) {
        // Obtener sesión actual de Supabase Auth
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        
        if (sessionError || !session) {
            console.error("Sesión no válida:", sessionError);
            mostrarLogin();
            return "Tu sesión ha caducado. Por favor inicia sesión nuevamente.";
        }

        try {
            const response = await fetch(`${BACKEND_URL}/api/consultar`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.access_token}` // ✅ Token JWT aquí
                },
                body: JSON.stringify({ pregunta: pregunta, sessionId: sessionId })
            });
            
            // Manejo específico de errores de autenticación
            if (response.status === 401) {
                mostrarLogin();
                return "Tu sesión ha caducado o es inválida.";
            }
            
            const data = await response.json();
            return data.respuesta || "No se pudo procesar la consulta.";
        } catch (error) { 
            console.error("Error de conexión:", error);
            return "Error de conexión con el servidor legal."; 
        }
    }

    async function responder(p, addMsg, setLoad) { 
        setLoad(true); 
        try { 
            addMsg("🔍 Buscando en la base legal...", false); 
            const respuesta = await buscarEnBackend(p, currentSessionId); 
            addMsg(respuesta, false); 
        } catch(e) { 
            addMsg(`Error: ${e.message}`, false); 
        } 
        setLoad(false); 
    }

    // --- SESSION MANAGEMENT ---
    function generateTitle(text) {
        return text.length > 30 ? text.substring(0, 30) + "..." : text;
    }

    function saveSessionToHistory(id, title) {
        let history = JSON.parse(localStorage.getItem('lexnave_history') || '[]');
        history = history.filter(s => s.id !== id);
        history.unshift({ id, title, date: new Date().toLocaleDateString() });
        localStorage.setItem('lexnave_history', JSON.stringify(history));
        renderSidebar();
    }

    function loadChatFromHistory(sessionId, title) {
        currentSessionId = sessionId;
        document.getElementById('chatMessages').innerHTML = `<div class="bot-message">📚 Cargando memoria de: "${title}"...</div>`;
        if(isMobile) toggleSidebar();
        renderSidebar();
        
        setTimeout(() => {
             document.getElementById('chatMessages').innerHTML = `<div class="bot-message">⚖️ Continuemos nuestra consulta sobre: <b>${title}</b></div>`;
        }, 800);
    }

    function deleteSession(e, id) {
        e.stopPropagation();
        let history = JSON.parse(localStorage.getItem('lexnave_history') || '[]');
        history = history.filter(s => s.id !== id);
        localStorage.setItem('lexnave_history', JSON.stringify(history));
        if(currentSessionId === id) newChat();
        else renderSidebar();
    }

    function newChat() {
        currentSessionId = crypto.randomUUID();
        document.getElementById('chatMessages').innerHTML = `<div class="bot-message">📚 Hola, soy LexnaVe. ¿En qué puedo ayudarte hoy?</div>`;
        if(isMobile) toggleSidebar();
        renderSidebar();
    }

    function renderSidebar() {
        const list = document.getElementById('historyList');
        if(!list) return;
        
        let history = JSON.parse(localStorage.getItem('lexnave_history') || '[]');
        list.innerHTML = history.map(s => `
            <div class="history-item ${s.id === currentSessionId ? 'active' : ''}" onclick="loadChatFromHistory('${s.id}', '${s.title.replace(/'/g, "\\'")}')">
                <span>${s.title}</span>
                <span class="delete-session" onclick="deleteSession(event, '${s.id}')">✕</span>
            </div>
        `).join('');
    }

    function toggleSidebar() {
        document.querySelector('.sidebar').classList.toggle('open');
    }

    // --- UI RENDERERS ---
    function mostrarChat() { 
        if(!currentSessionId) currentSessionId = crypto.randomUUID();
        
        document.getElementById('app').innerHTML = `
        <div class="main-layout">
            <div class="sidebar" id="sidebar">
                <button class="new-chat-btn" onclick="newChat()">＋ Nueva Consulta</button>
                <div class="history-list" id="historyList"></div>
            </div>
            
            <div class="chat-wrapper">
                <div class="chat-header">
                    <button class="menu-toggle" onclick="toggleSidebar()">☰</button>
                    <h2 class="text-gold">⚖️ LexnaVe ⚖️</h2>
                    <button class="logout-btn" onclick="logout()">⏻</button>
                </div>
                
                <div class="chat-messages" id="chatMessages">
                    <div class="bot-message">📚 Hola, soy LexnaVe. ¿En qué puedo ayudarte?</div>
                </div>
                
                <div id="loader" class="loader">⚖️ Analizando jurisprudencia...</div>
                
                <div class="chat-input-area">
                    <input type="text" id="preguntaInput" placeholder="Escribe tu consulta jurídica...">
                    <button id="enviarBtn">➤</button>
                </div>
            </div>
        </div>`; 
        
        renderSidebar();
        
        const input = document.getElementById('preguntaInput'); 
        const btn = document.getElementById('enviarBtn'); 
        const msgs = document.getElementById('chatMessages'); 
        const loader = document.getElementById('loader'); 
        
        const addMsg = (t, u) => { 
            const d = document.createElement('div'); 
            d.className = u ? 'user-message' : 'bot-message'; 
            d.innerText = t; 
            msgs.appendChild(d); 
            msgs.scrollTop = msgs.scrollHeight; 
        }; 
        
        const env = async () => { 
            const q = input.value.trim(); 
            if (!q) return; 
            
            const history = JSON.parse(localStorage.getItem('lexnave_history') || '[]');
            const isNew = !history.find(s => s.id === currentSessionId);
            if(isNew) saveSessionToHistory(currentSessionId, generateTitle(q));
            
            addMsg(q, true); 
            input.value = ''; 
            await responder(q, addMsg, (s) => loader.style.display = s ? 'block' : 'none'); 
        }; 
        
        btn.onclick = env; 
        input.onkeypress = (e) => { if (e.key === 'Enter') env(); }; 
    }

    async function logout() {
        await supabaseClient.auth.signOut();
        currentSessionId = null;
        localStorage.removeItem('lexnave_history'); // Opcional: limpiar historial local al salir
        mostrarLogin();
    }

    async function mostrarLogin() { 
        document.getElementById('app').innerHTML = `
        <div class="login-container">
            <div class="logo-area">
                <div class="flag-metal">
                    <div class="flag-strip yellow"></div>
                    <div class="flag-strip blue">
                        <span class="star">★</span><span class="star">★</span><span class="star">★</span>
                        <span class="star">★</span><span class="star">★</span><span class="star">★</span>
                        <span class="star">★</span><span class="star">★</span>
                    </div>
                    <div class="flag-strip red"></div>
                </div>
                <h1 class="text-gold" style="font-size: 3rem;">LexnaVe</h1>
                <p style="color: #aaa;">Sistema Jurídico Inteligente</p>
            </div>
            <div class="form-group"><input type="email" id="email" placeholder="Correo electrónico"></div>
            <div class="form-group"><input type="password" id="password" placeholder="Contraseña"></div>
            <button id="loginBtn" class="btn-gold">INGRESAR</button>
            <div id="errorMsg" class="error-msg"></div>
        </div>`; 
        
        document.getElementById('loginBtn').onclick = async () => { 
            const email = document.getElementById('email').value.trim(); 
            const pass = document.getElementById('password').value; 
            const errorEl = document.getElementById('errorMsg');
            
            if (!email || !pass) { 
                errorEl.innerText = "Completa ambos campos."; 
                return; 
            } 

            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: pass
            });

            if (error) {
                errorEl.innerText = error.message === "Invalid login credentials" 
                    ? "Correo o contraseña incorrectos." 
                    : "Error al iniciar sesión.";
            } else {
                mostrarChat(); 
            }
        }; 
    }

    // Verificar sesión al cargar la página
    async function initApp() {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            mostrarChat();
        } else {
            mostrarLogin();
        }
    }

    window.addEventListener('resize', () => { isMobile = window.innerWidth <= 768; });
    initApp();
</script>
</body>
</html>
