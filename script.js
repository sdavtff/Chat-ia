// Importações do Firebase (App, Auth, Firestore)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth,
    onAuthStateChanged,
    signInAnonymously,
    signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    onSnapshot, 
    serverTimestamp,
    setLogLevel,
    doc,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuração do Firebase ---
const firebaseConfigStr = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const apiKey = ""; // A API key é gerida pelo ambiente

let app, db, auth;
let currentUserId = null;
let globalUserName = null;
let currentTool = 'gemini';
let currentUnsubscribe = null;
let isLoading = false;

// --- DOM Elements ---
const loadingView = document.getElementById('loadingView');
const loadingViewText = loadingView.querySelector('p'); // Seleciona o texto de loading
const setupView = document.getElementById('setupView');
const appView = document.getElementById('appView');
const setupForm = document.getElementById('setupForm');
const nameInput = document.getElementById('nameInput');
const setupButton = document.getElementById('setupButton');
const setupError = document.getElementById('setupError');
const toolButtons = document.querySelectorAll('.tool-button');
const chatTitle = document.getElementById('chatTitle');
const userIdSpan = document.getElementById('userIdSpan');
const chatWindow = document.getElementById('chatWindow');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const loadingIndicator = document.getElementById('loadingIndicator');

// Configurações das Ferramentas
const toolsConfig = {
    'gemini': { title: 'Chat Gemini', placeholder: 'Pergunte ao Gemini...', model: 'gemini-2.5-flash-preview-09-2025' },
    'image': { title: 'Gerador de Imagem', placeholder: 'Descreva a imagem...', model: 'imagen-3.0-generate-002' },
    'openai': { title: 'Chat OpenAI (Simulado)', placeholder: 'Este chat é uma simulação...', model: 'simulated-openai' }
};

// --- Funções de UI (Vistas) ---

function showView(viewName) {
    loadingView.classList.add('hidden');
    setupView.classList.add('hidden');
    appView.classList.add('hidden');
    const viewToShow = document.getElementById(viewName + 'View');
    if (viewToShow) {
        viewToShow.classList.remove('hidden');
    }
}

// --- Funções de Inicialização e Autenticação ---

async function initializeFirebase() {
    let firebaseConfig;
    try {
        firebaseConfig = JSON.parse(firebaseConfigStr);
        // Verifica se a configuração tem chaves essenciais
        if (!firebaseConfig.apiKey || !firebaseConfig.authDomain) {
            throw new Error("Configuração do Firebase parece estar incompleta ou em falta.");
        }
    } catch (e) {
        console.error("Erro ao analisar a configuração do Firebase:", e);
        loadingViewText.textContent = "Erro: Configuração do Firebase inválida.";
        loadingView.querySelector('i').classList.add('hidden'); // Esconde o spinner
        return; // Pára a execução
    }

    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        setLogLevel('Debug');
        setupAuthListener(); // Inicia o ouvinte de autenticação
    } catch (error) {
        console.error("Erro ao inicializar o Firebase:", error);
        loadingViewText.textContent = `Erro ao inicializar: ${error.message}`;
        loadingView.querySelector('i').classList.add('hidden');
    }
}

function setupAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // --- Utilizador Anónimo está Logado ---
            currentUserId = user.uid;
            loadingViewText.textContent = "A verificar perfil...";
            
            const profileRef = doc(db, `/artifacts/${appId}/users/${currentUserId}/profile/main`);
            try {
                const profileSnap = await getDoc(profileRef);

                if (profileSnap.exists()) {
                    // --- Perfil Encontrado ---
                    globalUserName = profileSnap.data().name;
                    userIdSpan.textContent = globalUserName;
                    showView('app');
                    handleToolSelect('gemini'); 
                } else {
                    // --- Novo Utilizador (Sem Perfil) ---
                    showView('setup');
                }
            } catch (error) {
                console.error("Erro ao buscar perfil:", error);
                // Este erro pode acontecer se as regras do Firestore estiverem erradas
                showView('setup'); 
                setupError.textContent = "Erro ao verificar perfil. (Verifique as regras do Firestore).";
            }

        } else {
            // --- Ninguém Logado ---
            loadingViewText.textContent = "A autenticar...";
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
                // onAuthStateChanged será chamado novamente com o 'user'
            } catch (error) {
                console.error("Falha no login anónimo:", error);
                loadingViewText.textContent = "Erro: Falha no login anónimo. (Verifique se está ativado na consola Firebase)";
                loadingView.querySelector('i').classList.add('hidden');
            }
        }
    });
}

// --- Listeners de Eventos ---

setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (name === '' || !currentUserId) return;
    
    setupError.textContent = '';
    setupButton.disabled = true;
    setupButton.textContent = "A guardar...";

    try {
        const profileRef = doc(db, `/artifacts/${appId}/users/${currentUserId}/profile/main`);
        await setDoc(profileRef, { name: name });

        globalUserName = name;
        userIdSpan.textContent = globalUserName;
        showView('app');
        handleToolSelect('gemini');

    } catch (error) {
        console.error("Erro ao salvar nome:", error);
        setupError.textContent = "Erro ao salvar o nome. Tente novamente.";
    } finally {
        setupButton.disabled = false;
        setupButton.textContent = "Entrar";
    }
});


// --- Lógica da Aplicação (Chat, Ferramentas, API) ---

function handleToolSelect(toolName) {
    if (!currentUserId || isLoading) return; 

    currentTool = toolName;
    
    toolButtons.forEach(btn => {
        const selected = btn.id === `tool-${toolName}`;
        btn.setAttribute('aria-selected', selected.toString());
        btn.classList.toggle('bg-blue-600', selected);
        btn.classList.toggle('hover:rounded-xl', !selected);
        btn.classList.toggle('rounded-xl', selected);
        btn.classList.toggle('bg-gray-700', !selected);
    });

    const config = toolsConfig[currentTool];
    chatTitle.textContent = config.title;
    messageInput.placeholder = config.placeholder;
    messageInput.disabled = (currentTool === 'openai'); 

    setupChatListener(toolName);
}

function setupChatListener(toolName) {
    if (currentUnsubscribe) {
        currentUnsubscribe();
    }
    
    const chatColPath = `/artifacts/${appId}/users/${currentUserId}/${toolName}-chat/messages`;
    const messagesColRef = collection(db, chatColPath);
    const q = query(messagesColRef); 

    currentUnsubscribe = onSnapshot(q, (snapshot) => {
        let messages = [];
        snapshot.docs.forEach(doc => {
            messages.push({ id: doc.id, ...doc.data() });
        });

        messages.sort((a, b) => {
            const tsA = a.timestamp ? a.timestamp.seconds : 0;
            const tsB = b.timestamp ? b.timestamp.seconds : 0;
            return tsA - tsB;
        });

        renderMessages(messages);

    }, (error) => {
        console.error(`Erro ao buscar mensagens de ${toolName}:`, error);
        chatWindow.innerHTML = `<p class="text-red-500 text-center">Erro ao carregar histórico. (Verifique as regras do Firestore)</p>`;
    });
}

function renderMessages(messages) {
    chatWindow.innerHTML = '';
    chatWindow.appendChild(loadingIndicator); 

    if (messages.length === 0) {
        chatWindow.insertAdjacentHTML('afterbegin', `<p class="text-gray-400 text-center text-sm">Nenhuma mensagem ainda.</p>`);
    }
    
    messages.forEach(msg => {
        const bubble = document.createElement('div');
        bubble.className = `max-w-xl lg:max-w-3xl p-4 shadow-md ${msg.role === 'user' ? 'user-bubble' : 'bot-bubble'}`;

        if (msg.role === 'user') {
            const nameLabel = document.createElement('span');
            nameLabel.className = 'text-xs font-bold block mb-1 text-blue-100';
            nameLabel.textContent = globalUserName || 'Utilizador';
            bubble.appendChild(nameLabel);
        }

        if (msg.text) {
            const textP = document.createElement('p');
            textP.textContent = msg.text;
            bubble.appendChild(textP);
        } else if (msg.imageUrl) {
            const img = document.createElement('img');
            img.src = msg.imageUrl;
            img.className = "rounded-md max-w-sm h-auto mt-2";
            img.onerror = () => { bubble.textContent = "[Falha ao carregar imagem]" };
            bubble.appendChild(img);
        }
        chatWindow.insertBefore(bubble, loadingIndicator);
    });

    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function setLoadingState(loading) {
    isLoading = loading;
    sendButton.disabled = loading;
    messageInput.disabled = loading;
    loadingIndicator.classList.toggle('hidden', !loading);
    
    if (loading) {
         chatWindow.scrollTop = chatWindow.scrollHeight;
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const prompt = messageInput.value.trim();
    if (prompt === '' || isLoading || !currentUserId) return;

    setLoadingState(true);
    messageInput.value = '';

    const chatColPath = `/artifacts/${appId}/users/${currentUserId}/${currentTool}-chat/messages`;
    const messagesColRef = collection(db, chatColPath);
    
    try {
        await addDoc(messagesColRef, {
            role: 'user',
            text: prompt,
            userName: globalUserName || 'Anónimo', 
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Erro ao salvar mensagem do utilizador:", error);
        setLoadingState(false);
        // Adiciona uma mensagem de erro temporária
        renderMessages(getMessagesFromUI()); // Re-renderiza mensagens atuais
        chatWindow.insertAdjacentHTML('beforeend', `<p class="text-red-500 text-center text-sm">Falha ao enviar. Verifique as regras do Firestore.</p>`);
        return;
    }

    let botResponse = {};
    try {
        switch (currentTool) {
            case 'gemini':
                const geminiText = await callGeminiApi(prompt);
                botResponse = { role: 'model', text: geminiText };
                break;
            case 'image':
                const imageUrl = await callImageGenApi(prompt);
                botResponse = { role: 'model', imageUrl: imageUrl };
                break;
            case 'openai':
                const mockText = await callMockOpenAiApi(prompt);
                botResponse = { role: 'model', text: mockText };
                break;
        }
    } catch (error) {
        console.error(`Erro na API (${currentTool}):`, error);
        botResponse = { role: 'model', text: `Desculpe, ocorreu um erro: ${error.message}` };
    }

    if (botResponse.text || botResponse.imageUrl) {
        try {
            await addDoc(messagesColRef, {
                ...botResponse,
                timestamp: serverTimestamp()
            });
        } catch (error) {
             console.error("Erro ao salvar resposta do bot:", error);
        }
    }

    setLoadingState(false);
    messageInput.focus();
}

// Função auxiliar para obter mensagens atuais da UI (para restaurar em caso de falha)
function getMessagesFromUI() {
    const messages = [];
    chatWindow.querySelectorAll('.user-bubble, .bot-bubble').forEach(bubble => {
        if (bubble.id === 'loadingIndicator') return;
        
        const isUser = bubble.classList.contains('user-bubble');
        const role = isUser ? 'user' : 'model';
        const text = bubble.querySelector('p')?.textContent;
        const imageUrl = bubble.querySelector('img')?.src;
        
        if (text) messages.push({ role, text });
        if (imageUrl) messages.push({ role, imageUrl });
    });
    return messages;
}

/**
 * Wrapper de Fetch com retentativa (exponential backoff).
 */
async function fetchWithBackoff(url, options, maxRetries = 3) {
    let delay = 1000;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorBody = await response.json();
                console.error("Erro da API:", errorBody);
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.warn(`Tentativa ${i+1} falhou. Tentando novamente em ${delay}ms...`, error.message);
            if (i === maxRetries - 1) {
                throw error; 
            }
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
}

// --- Funções de API (Gemini, Imagen, Mock) ---

async function callGeminiApi(prompt) {
    const apiUrl = `https://generativelace.googleapis.com/v1beta/models/${toolsConfig.gemini.model}:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ parts: [{ text: prompt }] }]
    };
    const result = await fetchWithBackoff(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { throw new Error("Resposta inválida da API Gemini."); }
    return text;
}

async function callImageGenApi(prompt) {
    const apiUrl = `https://generativelace.googleapis.com/v1beta/models/${toolsConfig.image.model}:predict?key=${apiKey}`;
    const payload = { 
        instances: { prompt: prompt },
        parameters: { "sampleCount": 1 }
    };
    const result = await fetchWithBackoff(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const base64Data = result.predictions?.[0]?.bytesBase64Encoded;
    if (!base64Data) { throw new Error("Resposta inválida da API Imagen."); }
    return `data:image/png;base64,${base64Data}`;
}

async function callMockOpenAiApi(prompt) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve("Eu sou uma simulação de bot. Por favor, use o 'Chat Gemini' ou o 'Gerador de Imagem' para interações reais.");
        }, 1000);
    });
}

// --- Listeners de Eventos Globais ---
document.addEventListener('DOMContentLoaded', () => {
    // Verifica se os elementos essenciais existem antes de continuar
    if (loadingView && setupView && appView) {
        initializeFirebase();

        toolButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                handleToolSelect(btn.id.replace('tool-', ''));
            });
        });

        messageForm.addEventListener('submit', handleFormSubmit);
    } else {
        console.error("Erro fatal: Elementos da UI não encontrados.");
        document.body.innerHTML = "Erro fatal: A estrutura do HTML está em falta.";
    }
});
