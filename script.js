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
// Estas variáveis (__firebase_config, __app_id, __initial_auth_token)
// são injetadas pelo ambiente.
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const apiKey = ""; // A API key é gerida pelo ambiente

let app, db, auth;
let currentUserId = null; // Este será o ID anónimo
let globalUserName = null;
let currentTool = 'gemini';
let currentUnsubscribe = null;
let isLoading = false;

// --- DOM Elements ---
const loadingView = document.getElementById('loadingView');
const setupView = document.getElementById('setupView');
const appView = document.getElementById('appView');

// Elementos de Configuração (Setup)
const setupForm = document.getElementById('setupForm');
const nameInput = document.getElementById('nameInput');
const setupButton = document.getElementById('setupButton');
const setupError = document.getElementById('setupError');

// Elementos da Aplicação
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

/**
 * Controla qual ecrã (vista) está visível.
 */
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
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        setLogLevel('Debug');
        setupAuthListener(); // Ouve as mudanças de estado (anónimo)
    } catch (error) {
        console.error("Erro ao inicializar o Firebase:", error);
        loadingView.innerHTML = "Erro ao conectar.";
    }
}

/**
 * Ouve o estado de autenticação.
 * Tenta o login anónimo e depois verifica se existe um perfil de nome.
 */
function setupAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // --- Utilizador Anónimo está Logado ---
            currentUserId = user.uid;
            
            // Tenta buscar o perfil/nome associado a este ID anónimo
            const profileRef = doc(db, `/artifacts/${appId}/users/${currentUserId}/profile/main`);
            try {
                const profileSnap = await getDoc(profileRef);

                if (profileSnap.exists()) {
                    // --- Perfil Encontrado ---
                    globalUserName = profileSnap.data().name;
                    userIdSpan.textContent = globalUserName;
                    
                    // Entra direto na aplicação
                    showView('app');
                    handleToolSelect('gemini'); // Carrega o chat padrão
                } else {
                    // --- Novo Utilizador (Sem Perfil) ---
                    // Mostra o ecrã para definir o nome
                    showView('setup');
                }
            } catch (error) {
                console.error("Erro ao buscar perfil:", error);
                showView('setup'); // Mostra setup se houver erro ao buscar
                setupError.textContent = "Erro ao verificar perfil. Defina um nome.";
            }

        } else {
            // --- Ninguém Logado ---
            // Tenta fazer o login anónimo (ou com token)
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
                // onAuthStateChanged será chamado novamente com o 'user'
            } catch (error) {
                console.error("Falha no login anónimo:", error);
                loadingView.innerHTML = "Falha na autenticação anónima.";
            }
        }
    });
}

// --- Listeners de Eventos ---

// Submeter formulário de "Definir Nome"
setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (name === '' || !currentUserId) return;
    
    setupError.textContent = '';
    setupButton.disabled = true;

    try {
        // Guarda o nome no Firestore
        const profileRef = doc(db, `/artifacts/${appId}/users/${currentUserId}/profile/main`);
        await setDoc(profileRef, { name: name });

        // Continua para a aplicação
        globalUserName = name;
        userIdSpan.textContent = globalUserName;
        showView('app');
        handleToolSelect('gemini'); // Carrega o chat padrão

    } catch (error) {
        console.error("Erro ao salvar nome:", error);
        setupError.textContent = "Erro ao salvar o nome. Tente novamente.";
    } finally {
        setupButton.disabled = false;
    }
});


// --- Lógica da Aplicação (Chat, Ferramentas, API) ---

/**
 * Chamado quando um botão de ferramenta é clicado.
 */
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

/**
 * Configura o listener do Firestore para o histórico da ferramenta selecionada.
 */
function setupChatListener(toolName) {
    if (currentUnsubscribe) {
        currentUnsubscribe();
    }
    
    const chatColPath = `/artifacts/${appId}/users/${currentUserId}/${toolName}-chat/messages`;
    const messagesColRef = collection(db, chatColPath);
    const q = query(messagesColRef); // Sem orderBy, classificar no cliente

    currentUnsubscribe = onSnapshot(q, (snapshot) => {
        let messages = [];
        snapshot.docs.forEach(doc => {
            messages.push({ id: doc.id, ...doc.data() });
        });

        // Classifica as mensagens pelo timestamp no lado do cliente
        messages.sort((a, b) => {
            const tsA = a.timestamp ? a.timestamp.seconds : 0;
            const tsB = b.timestamp ? b.timestamp.seconds : 0;
            return tsA - tsB;
        });

        renderMessages(messages);

    }, (error) => {
        console.error(`Erro ao buscar mensagens de ${toolName}:`, error);
        chatWindow.innerHTML = `<p class="text-red-500 text-center">Erro ao carregar histórico.</p>`;
    });
}

/**
 * Renderiza as mensagens na janela de chat.
 */
function renderMessages(messages) {
    chatWindow.innerHTML = '';
    chatWindow.appendChild(loadingIndicator); 

    if (messages.length === 0) {
        chatWindow.insertAdjacentHTML('afterbegin', `<p class="text-gray-400 text-center text-sm">Nenhuma mensagem ainda.</p>`);
    }
    
    messages.forEach(msg => {
        const bubble = document.createElement('div');
        bubble.className = `max-w-xl lg:max-w-3xl p-4 shadow-md ${msg.role === 'user' ? 'user-bubble' : 'bot-bubble'}`;

        // Adiciona o nome do utilizador à bolha do utilizador
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

/**
 * Controla o estado de carregamento da UI
 */
function setLoadingState(loading) {
    isLoading = loading;
    sendButton.disabled = loading;
    messageInput.disabled = loading;
    loadingIndicator.classList.toggle('hidden', !loading);
    
    if (loading) {
         chatWindow.scrollTop = chatWindow.scrollHeight;
    }
}

/**
 * Manipula o envio do formulário.
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    const prompt = messageInput.value.trim();
    if (prompt === '' || isLoading || !currentUserId) return;

    setLoadingState(true);
    messageInput.value = '';

    const chatColPath = `/artifacts/${appId}/users/${currentUserId}/${currentTool}-chat/messages`;
    const messagesColRef = collection(db, chatColPath);
    
    try {
        // Agora também salvamos o nome do utilizador com a mensagem
        await addDoc(messagesColRef, {
            role: 'user',
            text: prompt,
            userName: globalUserName || 'Anónimo', // Salva o nome
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Erro ao salvar mensagem do utilizador:", error);
        setLoadingState(false);
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
        await addDoc(messagesColRef, {
            ...botResponse,
            timestamp: serverTimestamp()
        });
    }

    setLoadingState(false);
    messageInput.focus();
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
// Espera que o DOM esteja pronto para adicionar os listeners
document.addEventListener('DOMContentLoaded', () => {
    initializeFirebase();

    // Listeners da barra lateral
    toolButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            handleToolSelect(btn.id.replace('tool-', ''));
        });
    });

    // Listener do formulário
    messageForm.addEventListener('submit', handleFormSubmit);
});