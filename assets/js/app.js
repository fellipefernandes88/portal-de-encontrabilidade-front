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
        <section class="mb-4">
            <div class="d-flex align-items-end justify-content-between mb-3 flex-wrap gap-2">
                <div>
                    <h1 class="home-hero-title">Últimas do ${escapeHtml(PORTAL_NAME)}</h1>
                    <p class="home-hero-sub">Games, filmes, tecnologia e o que mais importa.</p>
                </div>
            </div>
            <div class="d-flex flex-wrap gap-2" id="quick-categories">
                ${state.categories.map(category => `
                    <a href="${BASE_PATH}/categoria/${category.slug}" data-link class="quick-pill">
                        ${escapeHtml(category.name)}
                    </a>
                `).join('')}
            </div>
        </section>

        <div id="hero-slot" class="mb-4"></div>

        <p class="section-title">Todas as notícias</p>
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

    const heroSlot = document.getElementById('hero-slot');
    const isFirst = state.homeCursor === 0;

    const nextItems = state.homeNotices.slice(state.homeCursor, state.homeCursor + state.homeBatch);

    if (!nextItems.length) {
        hideScrollLoader();
        disconnectObserver();
        return;
    }

    // Primeiro batch: primeiro item vai pro hero, o resto vai pro grid
    if (isFirst && heroSlot && nextItems.length > 0) {
        const hero = nextItems[0];
        const heroCategory = hero.category || {};

        heroSlot.innerHTML = `
            <a href="${BASE_PATH}/categoria/${heroCategory.slug}/noticia/${hero.slug}"
               data-link class="hero-banner">
                <img
                    src="${buildImageUrl(hero.path_image)}"
                    alt="${escapeHtml(hero.title)}"
                    loading="eager"
                >
                <div class="hero-banner-overlay"></div>
                <div class="hero-banner-body">
                    <span class="hero-banner-category">${escapeHtml(heroCategory.name || '')}</span>
                    <h2 class="hero-banner-title">${escapeHtml(hero.title)}</h2>
                    <p class="hero-banner-desc">${escapeHtml(hero.description || '')}</p>
                </div>
            </a>
        `;

        // Grid recebe o restante do primeiro batch
        const rest = nextItems.slice(1);
        grid.insertAdjacentHTML('beforeend', rest.map(renderNoticeCard).join(''));
    } else {
        grid.insertAdjacentHTML('beforeend', nextItems.map(renderNoticeCard).join(''));
    }

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

    header.innerHTML = `
        <div class="category-hero">
            <p class="section-title">${escapeHtml(category.name)}</p>
            <h1 class="category-hero-title">Notícias de ${escapeHtml(category.name)}</h1>
            <p class="category-hero-sub">
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
        <div class="article-wrap">
            <div class="article-header">
                <div class="skeleton mb-3" style="height:2rem; max-width:120px;"></div>
                <div class="skeleton mb-3" style="height:3rem;"></div>
                <div class="skeleton" style="height:1rem; max-width:200px;"></div>
            </div>
            <div class="skeleton" style="height:420px; border-radius:0;"></div>
            <div class="article-body">
                <div class="skeleton mb-3" style="height:1rem;"></div>
                <div class="skeleton mb-3" style="height:1rem; max-width:80%;"></div>
                <div class="skeleton" style="height:1rem; max-width:60%;"></div>
            </div>
        </div>
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

        if (categorySlugFromUrl !== notice.category.slug) {
            navigate(`${BASE_PATH}/categoria/${notice.category.slug}/noticia/${notice.slug}`);
            return;
        }

        app.innerHTML = `
            <article class="article-wrap">
                <header class="article-header">
                    <a href="${BASE_PATH}/categoria/${notice.category.slug}"
                       data-link class="article-category-badge">
                        ${escapeHtml(notice.category.name)}
                    </a>
                    <h1 class="article-title">${escapeHtml(notice.title)}</h1>
                    <p class="article-desc">${escapeHtml(notice.description)}</p>
                    <div class="article-meta">
                        <i class="bi bi-calendar3"></i>
                        Publicado em ${formatDate(notice.created_at)}
                    </div>
                </header>

                <div class="article-image-wrap">
                    <img
                        src="${buildImageUrl(notice.path_image)}"
                        alt="${escapeHtml(notice.title)}"
                        class="article-image"
                        loading="eager"
                    >
                </div>

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
            <article class="card notice-card border-0">
                <div class="notice-image-wrap">
                    <a href="${BASE_PATH}/categoria/${categorySlug}" data-link
                       class="notice-card-badge">
                        ${escapeHtml(categoryName)}
                    </a>
                    <a href="${BASE_PATH}/categoria/${categorySlug}/noticia/${notice.slug}"
                       data-link class="text-decoration-none">
                        <img
                            src="${buildImageUrl(notice.path_image)}"
                            alt="${escapeHtml(notice.title)}"
                            class="notice-image"
                            loading="lazy"
                        >
                    </a>
                </div>
                <div class="card-body">
                    <a href="${BASE_PATH}/categoria/${categorySlug}/noticia/${notice.slug}"
                       data-link class="notice-card-title d-block">
                        ${escapeHtml(notice.title)}
                    </a>
                    <p class="notice-card-desc">${escapeHtml(notice.description || '')}</p>
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
        <div class="not-found-wrap">
            <div class="not-found-code">404</div>
            <p class="text-muted mb-4">Essa página não existe ou foi removida.</p>
            <a href="${BASE_PATH}" data-link class="quick-pill">
                <i class="bi bi-house-fill"></i> Voltar para a home
            </a>
        </div>
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