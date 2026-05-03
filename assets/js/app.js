const { PORTAL_NAME, BASE_PATH, SITE_URL, API_BASE } = window.APP_CONFIG;

// Elementos principais da página
const app = document.getElementById('app');
const breadcrumb = document.getElementById('breadcrumb');
const categoryMenu = document.getElementById('category-menu');
const sentinel = document.getElementById('scroll-sentinel');
const scrollLoader = document.getElementById('scroll-loader');

// Variável que guarda o observer do scroll infinito
let observer = null;

// Estado global simples da aplicação
const state = {
    categories: [],          // lista de categorias do menu
    homeNotices: [],         // notícias usadas na home
    homeCursor: 0,           // posição atual do scroll batch da home
    homeBatch: 12,           // quantidade carregada por vez na home
    categorySlug: null,      // slug da categoria atual
    categoryName: '',        // nome da categoria atual
    categoryPage: 1,         // página atual da categoria
    categoryLastPage: 1,     // última página da categoria
    categoryLoading: false   // evita múltiplas requisições simultâneas
};

// Quando o DOM terminar de carregar, monta menu e chama o roteador
document.addEventListener('DOMContentLoaded', async () => {
    await loadCategoriesMenu();
    bindNavigation();
    router();
});

// Quando o usuário usa voltar/avançar do navegador, renderiza novamente
window.addEventListener('popstate', router);

/**
 * Intercepta cliques em links internos da SPA.
 * Assim evitamos recarregar a página inteira.
 */
function bindNavigation() {
    document.addEventListener('click', (event) => {
        const link = event.target.closest('[data-link]');
        if (!link) return;

        const href = link.getAttribute('href');

        // Ignora links vazios ou externos
        if (!href || href.startsWith('http')) return;

        event.preventDefault();
        navigate(href);
    });
}

/**
 * Navega entre páginas internas sem reload completo.
 */
function navigate(path) {
    // Proteção extra: se alguém abrir pelo file://, a SPA quebra
    if (window.location.protocol === 'file:') {
        alert('Abra o projeto por http://localhost/... e não pelo arquivo local.');
        return;
    }

    history.pushState({}, '', path);
    router();
}

/**
 * Roteador principal.
 * Identifica qual tela deve ser exibida com base na URL.
 */
function router() {
    // Sempre desconecta o observer anterior ao trocar de rota
    disconnectObserver();

    // Sempre esconde o loader ao trocar de tela
    hideScrollLoader();

    const path = normalizePath(window.location.pathname);

    // Rota de notícia
    const articleMatch = path.match(/^\/categoria\/([^/]+)\/noticia\/([^/]+)\/?$/);

    // Rota de categoria
    const categoryMatch = path.match(/^\/categoria\/([^/]+)\/?$/);

    // Home
    if (path === '/' || path === '' || path === '/index.html') {
        renderHome();
        return;
    }

    // Página da notícia
    if (articleMatch) {
        const [, categorySlug, noticeSlug] = articleMatch;
        renderArticle(categorySlug, noticeSlug);
        return;
    }

    // Página da categoria
    if (categoryMatch) {
        const [, categorySlug] = categoryMatch;
        renderCategory(categorySlug);
        return;
    }

    // Se nenhuma rota bater, mostra 404
    renderNotFound();
}

/**
 * Remove o BASE_PATH da URL para facilitar a leitura das rotas.
 * Exemplo: /portal/categoria/esporte -> /categoria/esporte
 */
function normalizePath(fullPath) {
    let path = fullPath;

    if (BASE_PATH !== '/' && path.startsWith(BASE_PATH)) {
        path = path.slice(BASE_PATH.length);
    }

    return path || '/';
}

/**
 * Função genérica para buscar dados da API.
 */
async function apiFetch(path = '') {
    const url = path ? `${API_BASE}${path}` : `${API_BASE}`;

    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Erro HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Carrega as categorias para montar o menu superior.
 */
async function loadCategoriesMenu() {
    try {
        const json = await apiFetch('/categories');
        state.categories = json.data || [];
        renderCategoryMenu();
    } catch (error) {
        console.error('Erro ao carregar categorias:', error);
    }
}

/**
 * Renderiza o menu com links para as categorias.
 */
function renderCategoryMenu() {
    categoryMenu.innerHTML = state.categories.map(category => `
        <a class="nav-link" href="${BASE_PATH}/categoria/${category.slug}" data-link>
            ${escapeHtml(category.name)}
        </a>
    `).join('');
}

/**
 * Renderiza a home.
 * A home usa scroll infinito local sobre a lista já carregada.
 */
async function renderHome() {
    showSentinel();

    setBreadcrumb([
        { label: 'Início', href: `${BASE_PATH}/` }
    ]);

    renderHomeSkeleton();

    try {
        const json = await apiFetch('');
        const categories = json.data || [];

        // Achata as notícias de várias categorias em um único array
        const notices = categories.flatMap(category =>
            (category.notices || []).map(notice => ({
                ...notice,
                category: {
                    name: category.name,
                    slug: category.slug
                }
            }))
        );

        // Ordena da mais nova para a mais antiga
        notices.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        state.homeNotices = notices;
        state.homeCursor = 0;

        setSeoHome();
        renderHomeLayout();
        appendHomeBatch();
        observeSentinel(appendHomeBatch);
    } catch (error) {
        console.error(error);
        renderError('Não foi possível carregar a home do portal.');
    }
}

/**
 * Skeleton da home enquanto os dados ainda não chegaram.
 */
function renderHomeSkeleton() {
    app.innerHTML = `
        <section class="mb-4">
            <div class="skeleton mb-3"></div>
            <div class="row g-4">
                ${Array.from({ length: 6 }).map(() => `
                    <div class="col-md-6 col-lg-4">
                        <div class="skeleton"></div>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

/**
 * Estrutura principal da home.
 */
function renderHomeLayout() {
    app.innerHTML = `
        <section class="mb-5">
            <div class="bg-white rounded-4 shadow-sm p-4 p-md-5">
                <h1 class="hero-title fw-bold mb-3">Últimas notícias do ${escapeHtml(PORTAL_NAME)}</h1>
                <p class="lead text-muted mb-0">
                    Política, esportes, finanças, tecnologia e os principais destaques do dia.
                </p>
            </div>
        </section>

        <section class="mb-4">
            <div class="d-flex flex-wrap gap-2" id="quick-categories">
                ${state.categories.map(category => `
                    <a href="${BASE_PATH}/categoria/${category.slug}" data-link class="btn btn-outline-secondary btn-sm">
                        ${escapeHtml(category.name)}
                    </a>
                `).join('')}
            </div>
        </section>

        <section>
            <div class="row g-4" id="home-grid"></div>
        </section>
    `;
}

/**
 * Adiciona mais um lote de notícias à home.
 * Isso simula scroll infinito na home.
 */
function appendHomeBatch() {
    const grid = document.getElementById('home-grid');
    if (!grid) return;

    const nextItems = state.homeNotices.slice(state.homeCursor, state.homeCursor + state.homeBatch);

    if (!nextItems.length) {
        hideScrollLoader();
        disconnectObserver();
        return;
    }

    grid.insertAdjacentHTML('beforeend', nextItems.map(renderNoticeCard).join(''));
    state.homeCursor += state.homeBatch;
}

/**
 * Renderiza a página de categoria.
 * Aqui o scroll infinito é feito buscando mais páginas da API.
 */
async function renderCategory(slug) {
    showSentinel();

    state.categorySlug = slug;
    state.categoryPage = 1;
    state.categoryLastPage = 1;
    state.categoryLoading = false;

    // Estrutura inicial da página da categoria
    app.innerHTML = `
        <section class="mb-4" id="category-header">
            <div class="bg-white rounded-4 shadow-sm p-4">
                <h1 class="fw-bold mb-2">Carregando categoria...</h1>
                <p class="text-muted mb-0">Buscando notícias.</p>
            </div>
        </section>

        <section>
            <div class="row g-4" id="category-grid"></div>
        </section>
    `;

    try {
        await loadCategoryPage();
        observeSentinel(loadCategoryPage);
    } catch (error) {
        console.error(error);
        renderError('Não foi possível carregar a categoria.');
    }
}

/**
 * Carrega uma página de notícias da categoria atual.
 */
async function loadCategoryPage() {
    if (state.categoryLoading) return;

    if (state.categoryPage > state.categoryLastPage) {
        hideScrollLoader();
        disconnectObserver();
        return;
    }

    state.categoryLoading = true;
    showScrollLoader();

    try {
        const json = await apiFetch(`/categories/${state.categorySlug}?page=${state.categoryPage}`);
        const category = json.category;
        const notices = json.notices;

        state.categoryName = category.name;
        state.categoryLastPage = notices.last_page;

        setBreadcrumb([
            { label: 'Início', href: `${BASE_PATH}/` },
            { label: category.name, href: `${BASE_PATH}/categoria/${category.slug}` }
        ]);

        setSeoCategory(category);
        renderCategoryHeader(category);

        const grid = document.getElementById('category-grid');
        if (grid) {
            grid.insertAdjacentHTML('beforeend', notices.data.map(renderNoticeCard).join(''));
        }

        state.categoryPage += 1;

        if (state.categoryPage > state.categoryLastPage) {
            hideScrollLoader();
            disconnectObserver();
        }
    } catch (error) {
        throw error;
    } finally {
        state.categoryLoading = false;
    }
}

/**
 * Cabeçalho da página da categoria.
 */
function renderCategoryHeader(category) {
    const header = document.getElementById('category-header');
    if (!header) return;

    // Substitui o conteúdo do loading pelo conteúdo real da categoria
    header.innerHTML = `
        <div class="bg-white rounded-4 shadow-sm p-4">
            <h1 class="fw-bold mb-2">Notícias de ${escapeHtml(category.name)}</h1>
            <p class="text-muted mb-0">
                Acompanhe as publicações mais recentes da categoria ${escapeHtml(category.name)}.
            </p>
        </div>
    `;
}
/**
 * Renderiza a página de notícia.
 * Aqui não existe scroll infinito, então escondemos o sentinel e o loader.
 */
async function renderArticle(categorySlugFromUrl, noticeSlug) {
    hideSentinel();
    hideScrollLoader();

    app.innerHTML = `
        <section class="bg-white rounded-4 shadow-sm p-4">
            <div class="skeleton mb-4"></div>
            <div class="skeleton mb-3"></div>
            <div class="skeleton mb-3"></div>
        </section>
    `;

    try {
        const json = await apiFetch(`/notices/${noticeSlug}`);
        const notice = json.data;

        setBreadcrumb([
            { label: 'Início', href: `${BASE_PATH}/` },
            { label: notice.category.name, href: `${BASE_PATH}/categoria/${notice.category.slug}` },
            { label: notice.title, href: `${BASE_PATH}/categoria/${notice.category.slug}/noticia/${notice.slug}` }
        ]);

        setSeoArticle(notice);

        // Se a categoria da URL não bater com a categoria real da notícia,
        // corrige a URL automaticamente.
        if (categorySlugFromUrl !== notice.category.slug) {
            navigate(`${BASE_PATH}/categoria/${notice.category.slug}/noticia/${notice.slug}`);
            return;
        }

        app.innerHTML = `
            <article class="bg-white rounded-4 shadow-sm p-4 p-md-5 notice-content">
                <header class="mb-4">
                    <a href="${BASE_PATH}/categoria/${notice.category.slug}" data-link class="badge text-bg-dark text-decoration-none mb-3">
                        ${escapeHtml(notice.category.name)}
                    </a>

                    <h1 class="fw-bold mb-3">${escapeHtml(notice.title)}</h1>
                    <p class="lead text-muted mb-3">${escapeHtml(notice.description)}</p>
                    <p class="text-secondary small mb-0">
                        Publicado em ${formatDate(notice.created_at)}
                    </p>
                </header>

                <figure class="mb-4">
                    <img
                        src="${buildImageUrl(notice.path_image)}"
                        alt="Imagem da notícia: ${escapeHtml(notice.title)}"
                        class="article-image"
                        loading="eager"
                    >
                </figure>

                <div class="article-body">
                    ${renderParagraphs(notice.notice)}
                </div>
            </article>
        `;
    } catch (error) {
        console.error(error);
        renderError('Não foi possível carregar a notícia.');
    }
}

/**
 * Renderiza um card de notícia.
 * É usado tanto na home quanto na página da categoria.
 */
function renderNoticeCard(notice) {
    const category = notice.category || {};
    const categorySlug = category.slug || '';
    const categoryName = category.name || '';

    return `
        <div class="col-md-6 col-lg-4">
            <article class="card border-0 shadow-sm notice-card">
                <a href="${BASE_PATH}/categoria/${categorySlug}/noticia/${notice.slug}" data-link class="text-decoration-none">
                    <img
                        src="${buildImageUrl(notice.path_image)}"
                        alt="Imagem da notícia: ${escapeHtml(notice.title)}"
                        class="card-img-top notice-image"
                        loading="lazy"
                    >
                </a>

                <div class="card-body">
                    <a href="${BASE_PATH}/categoria/${categorySlug}" data-link class="category-link small text-uppercase text-muted fw-semibold">
                        ${escapeHtml(categoryName)}
                    </a>

                    <h2 class="h5 mt-2">
                        <a href="${BASE_PATH}/categoria/${categorySlug}/noticia/${notice.slug}" data-link class="text-dark text-decoration-none">
                            ${escapeHtml(notice.title)}
                        </a>
                    </h2>

                    <p class="card-text text-muted mb-0">
                        ${escapeHtml(notice.description)}
                    </p>
                </div>
            </article>
        </div>
    `;
}

/**
 * Tela de erro genérica.
 */
function renderError(message) {
    hideScrollLoader();
    app.innerHTML = `
        <div class="alert alert-danger">
            ${escapeHtml(message)}
        </div>
    `;
}

/**
 * Tela 404.
 */
function renderNotFound() {
    hideSentinel();
    hideScrollLoader();

    setTitle(`Página não encontrada - ${PORTAL_NAME}`);
    updateMetaByName('description', 'A página solicitada não foi encontrada.');
    updateCanonical(`${SITE_URL}${window.location.pathname.replace(/\/$/, '')}`);

    app.innerHTML = `
        <section class="bg-white rounded-4 shadow-sm p-5 text-center">
            <h1 class="fw-bold mb-3">404</h1>
            <p class="text-muted mb-4">Página não encontrada.</p>
            <a href="${BASE_PATH}" data-link class="btn btn-dark">Voltar para a home</a>
        </section>
    `;
}

/**
 * Monta o breadcrumb dinâmico.
 */
function setBreadcrumb(items) {
    breadcrumb.innerHTML = items.map((item, index) => {
        const isLast = index === items.length - 1;
        return `
            <li class="breadcrumb-item ${isLast ? 'active' : ''}" ${isLast ? 'aria-current="page"' : ''}>
                ${isLast
                    ? escapeHtml(item.label)
                    : `<a href="${item.href}" data-link>${escapeHtml(item.label)}</a>`
                }
            </li>
        `;
    }).join('');
}

/**
 * SEO da home.
 */
function setSeoHome() {
    setTitle(`${PORTAL_NAME} - Últimas notícias`);
    updateMetaByName('description', `Acompanhe as últimas notícias de política, esportes, finanças, tecnologia e cotidiano no ${PORTAL_NAME}.`);
    updateCanonical(`${SITE_URL}/`);
    updateMetaProperty('og:type', 'website');
    updateMetaProperty('og:title', `${PORTAL_NAME} - Últimas notícias`);
    updateMetaProperty('og:description', `Acompanhe as últimas notícias de política, esportes, finanças, tecnologia e cotidiano no ${PORTAL_NAME}.`);
    updateMetaProperty('og:url', `${SITE_URL}/`);
    updateMetaProperty('og:image', `${new URL(API_BASE).origin}/storage/images/default-news.png`);
    updateMetaByName('twitter:title', `${PORTAL_NAME} - Últimas notícias`);
    updateMetaByName('twitter:description', `Acompanhe as últimas notícias de política, esportes, finanças, tecnologia e cotidiano no ${PORTAL_NAME}.`);
    updateMetaByName('twitter:image', `${new URL(API_BASE).origin}/storage/images/default-news.png`);

    setStructuredData({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": `${PORTAL_NAME} - Últimas notícias`,
        "url": `${SITE_URL}/`,
        "description": `Acompanhe as últimas notícias de política, esportes, finanças, tecnologia e cotidiano no ${PORTAL_NAME}.`
    });
}

/**
 * SEO da categoria.
 */
function setSeoCategory(category) {
    setTitle(`${category.name} - ${PORTAL_NAME}`);
    updateMetaByName('description', `Veja as notícias mais recentes da categoria ${category.name} no ${PORTAL_NAME}.`);
    updateCanonical(`${SITE_URL}/categoria/${category.slug}`);
    updateMetaProperty('og:type', 'website');
    updateMetaProperty('og:title', `${category.name} - ${PORTAL_NAME}`);
    updateMetaProperty('og:description', `Veja as notícias mais recentes da categoria ${category.name} no ${PORTAL_NAME}.`);
    updateMetaProperty('og:url', `${SITE_URL}/categoria/${category.slug}`);
    updateMetaByName('twitter:title', `${category.name} - ${PORTAL_NAME}`);
    updateMetaByName('twitter:description', `Veja as notícias mais recentes da categoria ${category.name} no ${PORTAL_NAME}.`);

    setStructuredData({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": `${category.name} - ${PORTAL_NAME}`,
        "url": `${SITE_URL}/categoria/${category.slug}`,
        "description": `Veja as notícias mais recentes da categoria ${category.name} no ${PORTAL_NAME}.`
    });
}

/**
 * SEO da notícia.
 */
function setSeoArticle(notice) {
    setTitle(`${notice.title} - ${PORTAL_NAME}`);
    updateMetaByName('description', notice.description || notice.title);
    updateCanonical(`${SITE_URL}/categoria/${notice.category.slug}/noticia/${notice.slug}`);
    updateMetaProperty('og:type', 'article');
    updateMetaProperty('og:title', `${notice.title} - ${PORTAL_NAME}`);
    updateMetaProperty('og:description', notice.description || notice.title);
    updateMetaProperty('og:url', `${SITE_URL}/categoria/${notice.category.slug}/noticia/${notice.slug}`);
    updateMetaProperty('og:image', buildImageUrl(notice.path_image));
    updateMetaByName('twitter:title', `${notice.title} - ${PORTAL_NAME}`);
    updateMetaByName('twitter:description', notice.description || notice.title);
    updateMetaByName('twitter:image', buildImageUrl(notice.path_image));

    setStructuredData({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": notice.title,
        "description": notice.description,
        "image": [buildImageUrl(notice.path_image)],
        "datePublished": notice.created_at,
        "dateModified": notice.created_at,
        "articleSection": notice.category.name,
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": `${SITE_URL}/categoria/${notice.category.slug}/noticia/${notice.slug}`
        },
        "publisher": {
            "@type": "Organization",
            "name": PORTAL_NAME
        }
    });
}

/**
 * Atualiza o título da aba.
 */
function setTitle(title) {
    document.title = title;
}

/**
 * Atualiza a canonical.
 */
function updateCanonical(url) {
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', url);
}

/**
 * Atualiza meta tag por name.
 */
function updateMetaByName(name, content) {
    let meta = document.querySelector(`meta[name="${name}"]`);

    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', name);
        document.head.appendChild(meta);
    }

    meta.setAttribute('content', content);
}

/**
 * Atualiza meta tag por property.
 */
function updateMetaProperty(property, content) {
    let meta = document.querySelector(`meta[property="${property}"]`);

    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('property', property);
        document.head.appendChild(meta);
    }

    meta.setAttribute('content', content);
}

/**
 * Atualiza o JSON-LD da página.
 */
function setStructuredData(data) {
    const script = document.getElementById('structured-data');
    if (script) {
        script.textContent = JSON.stringify(data, null, 2);
    }
}

/**
 * Monta URL da imagem.
 * Se já vier absoluta, usa direto.
 * Se vier relativa, prefixa com o domínio da API.
 */
function buildImageUrl(path) {
    if (!path) {
        return `${new URL(API_BASE).origin}/storage/images/default-news.png`;
    }

    if (/^https?:\/\//i.test(path)) {
        return path;
    }

    return `${new URL(API_BASE).origin}/storage/${String(path).replace(/^\/+/, '')}`;
}

/**
 * Converte o texto da notícia em parágrafos HTML.
 */
function renderParagraphs(text) {
    if (!text) return '<p>Conteúdo não disponível.</p>';

    return String(text)
        .split(/\n\s*\n/)
        .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

/**
 * Ativa o observer para o scroll infinito.
 */
function observeSentinel(callback) {
    if (!sentinel) return;

    observer = new IntersectionObserver((entries) => {
        const first = entries[0];
        if (first.isIntersecting) {
            callback();
        }
    }, {
        rootMargin: '200px'
    });

    observer.observe(sentinel);
}

/**
 * Desativa observer antigo.
 */
function disconnectObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

/**
 * Mostra o spinner do scroll infinito.
 */
function showScrollLoader() {
    if (scrollLoader) {
        scrollLoader.classList.remove('d-none');
    }
}

/**
 * Esconde o spinner do scroll infinito.
 */
function hideScrollLoader() {
    if (scrollLoader) {
        scrollLoader.classList.add('d-none');
    }
}

/**
 * Mostra a área do sentinel.
 * Usado em home e categoria.
 */
function showSentinel() {
    if (sentinel) {
        sentinel.classList.remove('d-none');
    }
}

/**
 * Esconde a área do sentinel.
 * Usado em notícia e 404.
 */
function hideSentinel() {
    if (sentinel) {
        sentinel.classList.add('d-none');
    }
}

/**
 * Formata data para pt-BR.
 */
function formatDate(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

/**
 * Escapa HTML para evitar quebra de layout e problemas de segurança.
 */
function escapeHtml(text) {
    return String(text ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}