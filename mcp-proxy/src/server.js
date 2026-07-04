import http from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PORT || 3000);
const wikiGraphqlUrl = requiredEnv('WIKIJS_GRAPHQL_URL');
const wikiApiToken = process.env.WIKIJS_API_TOKEN || '';
const configuredPublicUrl = (process.env.WIKI_PUBLIC_URL || '').replace(/\/$/, '');

const tools = [
  {
    name: 'wikijs_search_pages',
    description: 'Search Wiki.js pages by text and return ranked results with snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        locale: { type: 'string', default: 'en' },
        limit: { type: 'integer', default: 10 },
        pathPrefix: { type: 'string' },
        orderBy: { type: 'string', enum: ['updatedAt', 'createdAt'] }
      },
      required: ['query']
    }
  },
  {
    name: 'wikijs_get_page',
    description: 'Get one Wiki.js page by path or ID.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        id: { type: 'integer' },
        locale: { type: 'string', default: 'en' }
      }
    }
  },
  {
    name: 'wikijs_bulk_get_pages',
    description: 'Get multiple Wiki.js pages by ID and/or path in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer' } },
        paths: { type: 'array', items: { type: 'string' } },
        locale: { type: 'string', default: 'en' },
        continueOnError: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'wikijs_search_and_get_page',
    description: 'Search Wiki.js pages and return the full page for one strong match, otherwise ranked snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        locale: { type: 'string', default: 'en' }
      },
      required: ['query']
    }
  },
  {
    name: 'wikijs_get_page_by_title',
    description: 'Get one Wiki.js page by title.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        locale: { type: 'string', default: 'en' }
      },
      required: ['title']
    }
  },
  {
    name: 'wikijs_list_pages',
    description: 'List Wiki.js pages.',
    inputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string', default: 'en' },
        pathPrefix: { type: 'string' },
        limit: { type: 'integer', default: 50 },
        orderBy: { type: 'string', enum: ['updatedAt', 'createdAt'] }
      }
    }
  },
  {
    name: 'wikijs_create_page',
    description: 'Create a Wiki.js page.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        description: { type: 'string', default: '' },
        locale: { type: 'string', default: 'en' },
        tags: { type: 'array', items: { type: 'string' }, default: [] },
        isPublished: { type: 'boolean', default: true },
        isPrivate: { type: 'boolean', default: false },
        editor: { type: 'string', default: 'markdown' }
      },
      required: ['path', 'title', 'content']
    }
  },
  {
    name: 'wikijs_bulk_create_pages',
    description: 'Create multiple Wiki.js pages in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              title: { type: 'string' },
              content: { type: 'string' },
              description: { type: 'string', default: '' },
              locale: { type: 'string', default: 'en' },
              tags: { type: 'array', items: { type: 'string' }, default: [] },
              isPublished: { type: 'boolean', default: true },
              isPrivate: { type: 'boolean', default: false },
              editor: { type: 'string', default: 'markdown' }
            },
            required: ['path', 'title', 'content']
          }
        },
        continueOnError: { type: 'boolean', default: true }
      },
      required: ['pages']
    }
  },
  {
    name: 'wikijs_update_page',
    description: 'Update a Wiki.js page by path or ID. Omitted fields keep their existing values.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        id: { type: 'integer' },
        title: { type: 'string' },
        content: { type: 'string' },
        description: { type: 'string' },
        locale: { type: 'string', default: 'en' },
        tags: { type: 'array', items: { type: 'string' } },
        isPublished: { type: 'boolean' },
        isPrivate: { type: 'boolean' },
        editor: { type: 'string' }
      }
    }
  },
  {
    name: 'wikijs_bulk_update_pages',
    description: 'Update multiple Wiki.js pages in one call. Omitted fields keep their existing values.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              id: { type: 'integer' },
              title: { type: 'string' },
              content: { type: 'string' },
              description: { type: 'string' },
              locale: { type: 'string', default: 'en' },
              tags: { type: 'array', items: { type: 'string' } },
              isPublished: { type: 'boolean' },
              isPrivate: { type: 'boolean' },
              editor: { type: 'string' }
            }
          }
        },
        continueOnError: { type: 'boolean', default: true }
      },
      required: ['updates']
    }
  },
  {
    name: 'wikijs_replace_regex',
    description: 'Replace text in a Wiki.js page using a JavaScript regular expression.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        pattern: { type: 'string' },
        replacement: { type: 'string' },
        flags: { type: 'string', default: 'g' },
        locale: { type: 'string', default: 'en' }
      },
      required: ['page_id', 'pattern', 'replacement']
    }
  },
  {
    name: 'wikijs_delete_page',
    description: 'Delete a Wiki.js page by path or ID.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        id: { type: 'integer' },
        locale: { type: 'string', default: 'en' }
      }
    }
  },
  {
    name: 'wikijs_move_page',
    description: 'Move (rename/relocate) a Wiki.js page by path or ID to a new path and/or locale.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        id: { type: 'integer' },
        locale: { type: 'string', default: 'en' },
        destinationPath: { type: 'string' },
        destinationLocale: { type: 'string' }
      },
      required: ['destinationPath']
    }
  },
  {
    name: 'wikijs_bulk_move_pages',
    description: 'Move multiple Wiki.js pages in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        moves: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              id: { type: 'integer' },
              locale: { type: 'string', default: 'en' },
              destinationPath: { type: 'string' },
              destinationLocale: { type: 'string' }
            },
            required: ['destinationPath']
          }
        },
        continueOnError: { type: 'boolean', default: true }
      },
      required: ['moves']
    }
  },
  {
    name: 'wikijs_bulk_delete_pages',
    description: 'Delete multiple Wiki.js pages by ID and/or path in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer' } },
        paths: { type: 'array', items: { type: 'string' } },
        locale: { type: 'string', default: 'en' },
        continueOnError: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'wikijs_graphql',
    description: 'Run an authenticated Wiki.js GraphQL query or mutation.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        variables: { type: 'object' }
      },
      required: ['query']
    }
  }
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/healthz') {
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && isOpenApiPath(url.pathname)) {
      return json(res, 200, openApiDocument(req, 'rest'));
    }

    if (req.method === 'GET' && url.pathname === '/mcp') {
      return json(res, 200, openApiDocument(req, 'mcp-action'));
    }

    if (url.pathname.startsWith('/api/')) {
      return json(res, 200, await handleApiRequest(req, url));
    }

    if (url.pathname !== '/mcp') {
      return json(res, 404, { error: 'not_found' });
    }

    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return json(res, 405, { error: 'method_not_allowed' });
    }

    const rpc = await readJson(req);
    if (!rpc.jsonrpc && rpc.action) {
      return json(res, 200, await handleActionRequest(rpc));
    }

    const result = await handleRpc(rpc);
    return json(res, 200, {
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      result
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return json(res, status, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: error.message || 'internal_error'
      }
    });
  }
});

server.listen(port, () => {
  console.log(`Wiki.js MCP proxy listening on :${port}`);
});

async function handleRpc(rpc) {
  switch (rpc.method) {
    case 'initialize':
      return {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'wikijs-mcp-proxy', version: '0.1.0' }
      };

    case 'notifications/initialized':
      return {};

    case 'tools/list':
      return { tools };

    case 'tools/call':
      return callTool(rpc.params || {});

    default: {
      const error = new Error(`unsupported_method: ${rpc.method}`);
      error.statusCode = 400;
      throw error;
    }
  }
}

async function callTool(params) {
  const { name, arguments: args = {} } = params;

  switch (name) {
    case 'wikijs_search_pages':
      return mcpText(await searchPages(args));

    case 'wikijs_get_page':
      return mcpText(await getPage(args));

    case 'wikijs_bulk_get_pages':
      return mcpText(await bulkGetPages(args));

    case 'wikijs_search_and_get_page':
      return mcpText(await searchAndGetPage(args));

    case 'wikijs_get_page_by_title':
      return mcpText(await getPageByTitle(args));

    case 'wikijs_list_pages':
      return mcpText(await listPages(args));

    case 'wikijs_create_page':
      return mcpText(await createPage(args));

    case 'wikijs_bulk_create_pages':
      return mcpText(await bulkCreatePages(args));

    case 'wikijs_update_page':
      return mcpText(await updatePage(args));

    case 'wikijs_bulk_update_pages':
      return mcpText(await bulkUpdatePages(args));

    case 'wikijs_replace_regex':
      return mcpText(await replaceRegex(args));

    case 'wikijs_move_page':
      return mcpText(await movePage(args));

    case 'wikijs_bulk_move_pages':
      return mcpText(await bulkMovePages(args));

    case 'wikijs_delete_page':
      return mcpText(await deletePage(args));

    case 'wikijs_bulk_delete_pages':
      return mcpText(await bulkDeletePages(args));

    case 'wikijs_graphql':
      return mcpText(await wikiGraphql(args.query, args.variables || {}));

    default: {
      const error = new Error(`unknown_tool: ${name}`);
      error.statusCode = 400;
      throw error;
    }
  }
}

async function handleApiRequest(req, url) {
  if (req.method !== 'POST') {
    const error = new Error('method_not_allowed');
    error.statusCode = 405;
    throw error;
  }

  const args = await readJson(req);

  switch (url.pathname) {
    case '/api/pages/search':
      return searchPages(args);

    case '/api/pages/get':
      return getPage(args);

    case '/api/pages/bulk_get':
      return bulkGetPages(args);

    case '/api/pages/search_and_get':
      return searchAndGetPage(args);

    case '/api/pages/get_by_title':
      return getPageByTitle(args);

    case '/api/pages/list':
      return listPages(args);

    case '/api/pages/create':
      return createPage(args);

    case '/api/pages/bulk_create':
      return bulkCreatePages(args);

    case '/api/pages/update':
      return updatePage(args);

    case '/api/pages/bulk_update':
      return bulkUpdatePages(args);

    case '/api/pages/replace_regex':
      return replaceRegex(args);

    case '/api/pages/move':
      return movePage(args);

    case '/api/pages/bulk_move':
      return bulkMovePages(args);

    case '/api/pages/delete':
      return deletePage(args);

    case '/api/pages/bulk_delete':
      return bulkDeletePages(args);

    case '/api/graphql':
      return wikiGraphql(args.query, args.variables || {});

    default: {
      const error = new Error('not_found');
      error.statusCode = 404;
      throw error;
    }
  }
}

async function handleActionRequest(args) {
  switch (args.action) {
    case 'searchPages':
      return searchPages(args.arguments || {});

    case 'getPage':
      return getPage(args.arguments || {});

    case 'bulkGetPages':
      return bulkGetPages(args.arguments || {});

    case 'searchAndGetPage':
    case 'search_and_get_page':
      return searchAndGetPage(args.arguments || {});

    case 'getPageByTitle':
    case 'get_page_by_title':
      return getPageByTitle(args.arguments || {});

    case 'listPages':
      return listPages(args.arguments || {});

    case 'createPage':
      return createPage(args.arguments || {});

    case 'bulkCreatePages':
      return bulkCreatePages(args.arguments || {});

    case 'updatePage':
      return updatePage(args.arguments || {});

    case 'bulkUpdatePages':
      return bulkUpdatePages(args.arguments || {});

    case 'replaceRegex':
    case 'replace_regex':
      return replaceRegex(args.arguments || {});

    case 'movePage':
      return movePage(args.arguments || {});

    case 'bulkMovePages':
      return bulkMovePages(args.arguments || {});

    case 'deletePage':
      return deletePage(args.arguments || {});

    case 'bulkDeletePages':
      return bulkDeletePages(args.arguments || {});

    case 'runGraphql':
      return wikiGraphql(args.arguments?.query, args.arguments?.variables || {});

    default:
      badRequest('action must be one of searchPages, getPage, bulkGetPages, searchAndGetPage, search_and_get_page, getPageByTitle, get_page_by_title, listPages, createPage, bulkCreatePages, updatePage, bulkUpdatePages, replaceRegex, replace_regex, movePage, bulkMovePages, deletePage, bulkDeletePages, runGraphql.');
  }
}

async function searchPages(args) {
  const query = requireString(args.query, 'query');
  const locale = optionalString(args.locale, 'locale') ?? 'en';
  const limit = optionalInteger(args.limit, 'limit') ?? 10;
  const pathPrefix = optionalString(args.pathPrefix, 'pathPrefix');
  const orderBy = optionalOrderBy(args.orderBy);

  const data = await wikiGraphql(
    `query SearchPages($query: String!, $locale: String!) {
      pages {
        search(query: $query, locale: $locale) {
          results {
            id
            title
            description
            path
            locale
          }
        }
      }
    }`,
    { query, locale }
  );

  let results = (data?.pages?.search?.results || []).map(normalizeSearchResult);
  results = filterByPathPrefix(results, pathPrefix);
  if (!orderBy) {
    results = results.slice(0, limit);
  }

  let pages = await pagesWithSnippets(results, query, locale);
  pages = sortPages(pages, orderBy).slice(0, limit);
  return {
    query,
    locale,
    pathPrefix,
    orderBy,
    count: pages.length,
    results: pages
  };
}

async function getPage(args) {
  const id = optionalInteger(args.id, 'id');
  const path = optionalString(args.path, 'path');
  const locale = optionalString(args.locale, 'locale') ?? 'en';

  if (id === undefined && path === undefined) {
    badRequest('Provide either id or path.');
  }

  const searched = id !== undefined ? { id } : { path };
  let data;
  if (id !== undefined) {
    data = await wikiGraphql(
      `query GetPageById($id: Int!) {
        pages {
          single(id: $id) {
            id
            path
            locale
            title
            description
            content
            render
            editor
            isPublished
            isPrivate
            privateNS
            tags {
              tag
              title
            }
            createdAt
            updatedAt
          }
        }
      }`,
      { id }
    );
  } else {
    data = await wikiGraphql(
      `query GetPageByPath($path: String!, $locale: String!) {
        pages {
          singleByPath(path: $path, locale: $locale) {
            id
            path
            locale
            title
            description
            content
            render
            editor
            isPublished
            isPrivate
            privateNS
            tags {
              tag
              title
            }
            createdAt
            updatedAt
          }
        }
      }`,
      { path, locale }
    );
  }

  const page = normalizePage(data?.pages?.single || data?.pages?.singleByPath);
  if (page) {
    return page;
  }

  return notFoundResult('page', searched, locale, await closestPageSuggestions({ ...searched, locale }));
}

async function bulkGetPages(args) {
  const locale = optionalString(args.locale, 'locale') ?? 'en';
  const continueOnError = args.continueOnError ?? true;
  const ids = optionalIntegerArray(args.ids, 'ids');
  const paths = optionalStringArray(args.paths, 'paths');
  const selectors = [
    ...ids.map((id) => ({ id, locale })),
    ...paths.map((path) => ({ path, locale }))
  ];

  if (selectors.length === 0) {
    badRequest('Provide at least one id or path in ids/paths.');
  }

  const results = [];
  for (const selector of selectors) {
    try {
      const page = await getPage(selector);
      results.push({ selector, succeeded: true, page });
    } catch (error) {
      results.push({ selector, succeeded: false, error: error.message || 'get_failed' });
      if (!continueOnError) {
        break;
      }
    }
  }

  return {
    locale,
    attempted: selectors.length,
    succeeded: results.filter((result) => result.succeeded).length,
    failed: results.filter((result) => !result.succeeded).length,
    results
  };
}

async function searchAndGetPage(args) {
  const query = requireString(args.query, 'query');
  const locale = optionalString(args.locale, 'locale') ?? 'en';
  const search = await searchPages({ query, locale, limit: 8 });
  const strongMatch = strongSearchMatch(query, search.results);

  if (!strongMatch) {
    return {
      query,
      locale,
      match: 'multiple',
      count: search.count,
      results: search.results
    };
  }

  return {
    query,
    locale,
    match: 'single',
    page: await getPage({ id: strongMatch.id, locale })
  };
}

async function getPageByTitle(args) {
  const title = requireString(args.title, 'title');
  const locale = optionalString(args.locale, 'locale') ?? 'en';
  const pages = (await fetchPageList({ locale, limit: 500 })).map(normalizePageListItem);
  const ranked = rankPages(title, pages, ['title', 'path']);
  const exact = ranked.find((page) => normalizeComparable(page.title) === normalizeComparable(title));

  if (exact) {
    return getPage({ id: exact.id, locale });
  }

  if (ranked.length === 1 || (ranked[0]?.score >= 90 && ranked[0].score - (ranked[1]?.score ?? 0) >= 25)) {
    return getPage({ id: ranked[0].id, locale });
  }

  return notFoundResult('title', { title }, locale, ranked.slice(0, 5).map(pageSuggestion));
}

async function listPages(args) {
  const locale = optionalString(args.locale, 'locale') ?? 'en';
  const pathPrefix = optionalString(args.pathPrefix, 'pathPrefix');
  const limit = optionalInteger(args.limit, 'limit') ?? 50;
  const orderBy = optionalOrderBy(args.orderBy);
  const fetchLimit = pathPrefix ? Math.max(limit, 1000) : Math.max(limit, 250);
  let pages = (await fetchPageList({ locale, limit: fetchLimit })).map(normalizePageListItem);
  pages = filterByPathPrefix(pages, pathPrefix);
  pages = sortPages(pages, orderBy);
  pages = pages.slice(0, limit);

  return {
    locale,
    pathPrefix,
    orderBy,
    count: pages.length,
    results: pages
  };
}

async function fetchPageList({ locale, limit }) {
  const data = await wikiGraphql(
    `query ListPages($locale: String, $limit: Int) {
      pages {
        list(locale: $locale, limit: $limit) {
          id
          path
          locale
          title
          description
          isPublished
          isPrivate
          privateNS
          tags
          createdAt
          updatedAt
        }
      }
    }`,
    {
      locale,
      limit
    }
  );
  return data?.pages?.list || [];
}

async function createPage(args) {
  const page = pageMutationInput({
    path: requireString(args.path, 'path'),
    title: requireString(args.title, 'title'),
    content: requireString(args.content, 'content'),
    description: args.description || '',
    locale: args.locale || 'en',
    tags: tagsInput(args.tags),
    isPublished: args.isPublished ?? true,
    isPrivate: args.isPrivate ?? false,
    editor: args.editor || 'markdown'
  });

  return wikiGraphql(
    `mutation CreatePage(
      $content: String!
      $description: String!
      $editor: String!
      $isPublished: Boolean!
      $isPrivate: Boolean!
      $locale: String!
      $path: String!
      $tags: [String]!
      $title: String!
    ) {
      pages {
        create(
          content: $content
          description: $description
          editor: $editor
          isPublished: $isPublished
          isPrivate: $isPrivate
          locale: $locale
          path: $path
          tags: $tags
          title: $title
        ) {
          responseResult {
            succeeded
            errorCode
            slug
            message
          }
        }
      }
    }`,
    page
  );
}

async function bulkCreatePages(args) {
  const continueOnError = args.continueOnError ?? true;
  const pages = optionalObjectArray(args.pages, 'pages');

  if (pages.length === 0) {
    badRequest('Provide at least one page in pages.');
  }

  const results = [];
  for (const page of pages) {
    try {
      const response = await createPage(page);
      results.push({ page: { path: page.path, locale: page.locale || 'en' }, succeeded: true, response });
    } catch (error) {
      results.push({ page: { path: page.path, locale: page.locale || 'en' }, succeeded: false, error: error.message || 'create_failed' });
      if (!continueOnError) {
        break;
      }
    }
  }

  return {
    attempted: pages.length,
    succeeded: results.filter((result) => result.succeeded).length,
    failed: results.filter((result) => !result.succeeded).length,
    results
  };
}

async function updatePage(args) {
  const existing = await resolvePage(args);
  const existingTags = Array.isArray(existing.tags)
    ? existing.tags.map((tag) => typeof tag === 'string' ? tag : tag.tag).filter(Boolean)
    : [];
  const page = pageMutationInput({
    id: existing.id,
    path: args.path ?? existing.path,
    title: args.title ?? existing.title,
    content: args.content ?? existing.content ?? '',
    description: args.description ?? existing.description ?? '',
    locale: args.locale ?? existing.locale ?? 'en',
    tags: args.tags === undefined ? existingTags : tagsInput(args.tags),
    isPublished: args.isPublished ?? existing.isPublished ?? true,
    isPrivate: args.isPrivate ?? existing.isPrivate ?? false,
    editor: args.editor || 'markdown'
  });

  return wikiGraphql(
    `mutation UpdatePage(
      $id: Int!
      $content: String!
      $description: String!
      $editor: String!
      $isPublished: Boolean!
      $isPrivate: Boolean!
      $locale: String!
      $path: String!
      $tags: [String]!
      $title: String!
    ) {
      pages {
        update(
          id: $id
          content: $content
          description: $description
          editor: $editor
          isPublished: $isPublished
          isPrivate: $isPrivate
          locale: $locale
          path: $path
          tags: $tags
          title: $title
        ) {
          responseResult {
            succeeded
            errorCode
            slug
            message
          }
        }
      }
    }`,
    page
  );
}

async function bulkUpdatePages(args) {
  const continueOnError = args.continueOnError ?? true;
  const updates = optionalObjectArray(args.updates, 'updates');

  if (updates.length === 0) {
    badRequest('Provide at least one update in updates.');
  }

  const results = [];
  for (const update of updates) {
    const selector = { path: update.path, id: update.id, locale: update.locale || 'en' };
    try {
      const response = await updatePage(update);
      results.push({ update: selector, succeeded: true, response });
    } catch (error) {
      results.push({ update: selector, succeeded: false, error: error.message || 'update_failed' });
      if (!continueOnError) {
        break;
      }
    }
  }

  return {
    attempted: updates.length,
    succeeded: results.filter((result) => result.succeeded).length,
    failed: results.filter((result) => !result.succeeded).length,
    results
  };
}

async function replaceRegex(args) {
  const pageId = optionalInteger(args.page_id ?? args.id, 'page_id');
  if (pageId === undefined) {
    badRequest('page_id must be an integer.');
  }

  const pattern = requireString(args.pattern, 'pattern');
  const replacement = optionalString(args.replacement, 'replacement');
  if (replacement === undefined) {
    badRequest('replacement must be a string.');
  }

  const flags = optionalString(args.flags, 'flags') ?? 'g';
  const expression = regexFromInput(pattern, flags);
  const existing = await resolvePage({ id: pageId, locale: args.locale || 'en' });
  const originalContent = existing.content ?? '';
  const matchCount = countRegexMatches(originalContent, pattern, flags);
  const updatedContent = originalContent.replace(expression, replacement);
  const resultSummary = {
    page: {
      id: existing.id,
      path: existing.path,
      locale: existing.locale,
      title: existing.title
    },
    matches: matchCount,
    replacements: matchCount,
    changed: updatedContent !== originalContent,
    diff: firstChangedLineDiff(originalContent, updatedContent)
  };

  if (updatedContent === originalContent) {
    return resultSummary;
  }

  const updateResult = await updatePage({
    id: existing.id,
    locale: existing.locale,
    content: updatedContent
  });

  return {
    ...updateResult,
    ...resultSummary
  };
}

async function movePage(args) {
  const existing = await resolvePage(args);
  const destinationPath = requireString(args.destinationPath, 'destinationPath');
  const destinationLocale = optionalString(args.destinationLocale, 'destinationLocale') ?? existing.locale;

  return wikiGraphql(
    `mutation MovePage($id: Int!, $destinationPath: String!, $destinationLocale: String!) {
      pages {
        move(id: $id, destinationPath: $destinationPath, destinationLocale: $destinationLocale) {
          responseResult {
            succeeded
            errorCode
            slug
            message
          }
        }
      }
    }`,
    { id: existing.id, destinationPath, destinationLocale }
  );
}

async function bulkMovePages(args) {
  const continueOnError = args.continueOnError ?? true;
  const moves = optionalObjectArray(args.moves, 'moves');

  if (moves.length === 0) {
    badRequest('Provide at least one move in moves.');
  }

  const results = [];
  for (const move of moves) {
    try {
      const response = await movePage(move);
      results.push({ move, succeeded: true, response });
    } catch (error) {
      results.push({ move, succeeded: false, error: error.message || 'move_failed' });
      if (!continueOnError) {
        break;
      }
    }
  }

  return {
    attempted: moves.length,
    succeeded: results.filter((result) => result.succeeded).length,
    failed: results.filter((result) => !result.succeeded).length,
    results
  };
}

async function deletePage(args) {
  const existing = await resolvePage(args);
  return wikiGraphql(
    `mutation DeletePage($id: Int!) {
      pages {
        delete(id: $id) {
          responseResult {
            succeeded
            errorCode
            slug
            message
          }
        }
      }
    }`,
    { id: existing.id }
  );
}

async function bulkDeletePages(args) {
  const locale = optionalString(args.locale, 'locale') ?? 'en';
  const continueOnError = args.continueOnError ?? true;
  const ids = optionalIntegerArray(args.ids, 'ids');
  const paths = optionalStringArray(args.paths, 'paths');
  const selectors = [
    ...ids.map((id) => ({ id, locale })),
    ...paths.map((path) => ({ path, locale }))
  ];

  if (selectors.length === 0) {
    badRequest('Provide at least one id or path in ids/paths.');
  }

  const results = [];
  for (const selector of selectors) {
    try {
      const response = await deletePage(selector);
      results.push({ selector, succeeded: true, response });
    } catch (error) {
      results.push({ selector, succeeded: false, error: error.message || 'delete_failed' });
      if (!continueOnError) {
        break;
      }
    }
  }

  return {
    locale,
    attempted: selectors.length,
    succeeded: results.filter((result) => result.succeeded).length,
    failed: results.filter((result) => !result.succeeded).length,
    results
  };
}

function optionalIntegerArray(value, name) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    badRequest(`${name} must be an array of integers.`);
  }
  return value.map((entry) => optionalInteger(entry, name));
}

function optionalStringArray(value, name) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    badRequest(`${name} must be an array of strings.`);
  }
  return value;
}

function optionalObjectArray(value, name) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))) {
    badRequest(`${name} must be an array of objects.`);
  }
  return value;
}

async function resolvePage(args) {
  const page = await getPage(args);
  if (!page?.found) {
    const error = new Error(`Page not found: ${JSON.stringify(page)}`);
    error.statusCode = 404;
    throw error;
  }
  return page;
}

async function pagesWithSnippets(results, query, locale) {
  const pages = [];
  for (const result of results) {
    const page = await getPage({ id: result.id, locale });
    if (page?.found) {
      pages.push({
        id: page.id,
        title: page.title,
        path: page.path,
        description: page.description,
        locale: page.locale,
        snippet: snippetForPage(page, query),
        createdAt: page.createdAt,
        updatedAt: page.updatedAt
      });
    } else {
      pages.push({
        ...result,
        snippet: snippetFromText([result.title, result.description, result.path].filter(Boolean).join('\n'), query)
      });
    }
  }
  return pages;
}

function normalizePage(page) {
  if (!page) {
    return null;
  }

  return {
    found: true,
    id: page.id,
    title: page.title,
    path: page.path,
    content: page.content,
    description: page.description,
    locale: page.locale,
    tags: normalizeTags(page.tags),
    editor: page.editor,
    isPublished: page.isPublished,
    isPrivate: page.isPrivate,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt
  };
}

function normalizeSearchResult(page) {
  return {
    id: page.id,
    title: page.title,
    path: page.path,
    description: page.description,
    locale: page.locale
  };
}

function normalizePageListItem(page) {
  return {
    id: page.id,
    title: page.title,
    path: page.path,
    description: page.description,
    locale: page.locale,
    tags: normalizeTags(page.tags),
    isPublished: page.isPublished,
    isPrivate: page.isPrivate,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt
  };
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags.map((tag) => typeof tag === 'string' ? tag : tag.tag || tag.title).filter(Boolean);
}

function snippetForPage(page, query) {
  return snippetFromText([
    page.title,
    page.description,
    page.content
  ].filter(Boolean).join('\n\n'), query);
}

function snippetFromText(text, query, radius = 220) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = compact.toLowerCase();
  const index = queryTerms
    .map((term) => lower.indexOf(term))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, index - radius);
  const end = Math.min(compact.length, index + radius);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < compact.length ? '...' : '';
  return `${prefix}${compact.slice(start, end)}${suffix}`;
}

function filterByPathPrefix(pages, pathPrefix) {
  if (!pathPrefix) {
    return pages;
  }
  const normalizedPrefix = pathPrefix.replace(/^\/+|\/+$/g, '');
  return pages.filter((page) => String(page.path || '').replace(/^\/+/, '').startsWith(normalizedPrefix));
}

function sortPages(pages, orderBy) {
  if (!orderBy) {
    return pages;
  }
  return [...pages].sort((left, right) => {
    const leftValue = Date.parse(left[orderBy] || '') || 0;
    const rightValue = Date.parse(right[orderBy] || '') || 0;
    return rightValue - leftValue;
  });
}

function optionalOrderBy(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value !== 'updatedAt' && value !== 'createdAt') {
    badRequest('orderBy must be "updatedAt" or "createdAt".');
  }
  return value;
}

function strongSearchMatch(query, results) {
  if (results.length === 0) {
    return null;
  }
  if (results.length === 1) {
    return results[0];
  }

  const normalizedQuery = normalizeComparable(query);
  const exact = results.find((page) =>
    normalizeComparable(page.title) === normalizedQuery
    || normalizeComparable(page.path) === normalizedQuery
  );
  return exact || null;
}

async function closestPageSuggestions(args) {
  const locale = optionalString(args.locale, 'locale') ?? 'en';
  const query = args.path || args.title || String(args.id ?? '');
  const pages = (await fetchPageList({ locale, limit: 500 })).map(normalizePageListItem);
  return rankPages(query, pages, ['title', 'path']).slice(0, 5).map(pageSuggestion);
}

function rankPages(query, pages, fields) {
  const normalizedQuery = normalizeComparable(query);
  if (!normalizedQuery) {
    return pages.slice(0, 5).map((page) => ({ ...page, score: 0 }));
  }

  return pages
    .map((page) => ({
      ...page,
      score: Math.max(...fields.map((field) => similarityScore(normalizedQuery, normalizeComparable(page[field]))))
    }))
    .filter((page) => page.score > 0)
    .sort((left, right) => right.score - left.score);
}

function similarityScore(query, value) {
  if (!value) {
    return 0;
  }
  if (value === query) {
    return 100;
  }
  if (value.includes(query)) {
    return 90;
  }
  if (query.includes(value)) {
    return 80;
  }
  const queryTerms = new Set(query.split(/\s+/).filter(Boolean));
  const valueTerms = new Set(value.split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const term of queryTerms) {
    if (valueTerms.has(term)) {
      overlap += 1;
    }
  }
  return overlap === 0 ? 0 : Math.round((overlap / queryTerms.size) * 70);
}

function normalizeComparable(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageSuggestion(page) {
  return {
    id: page.id,
    title: page.title,
    path: page.path,
    locale: page.locale,
    description: page.description,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    score: page.score
  };
}

function notFoundResult(kind, searched, locale, suggestions) {
  return {
    found: false,
    error: 'page_not_found',
    searched: {
      kind,
      ...searched
    },
    locale,
    suggestions
  };
}

function pageMutationInput(page) {
  return {
    ...page,
    id: optionalInteger(page.id, 'id'),
    path: requireString(page.path, 'path'),
    title: requireString(page.title, 'title'),
    content: requireString(page.content, 'content'),
    description: optionalString(page.description, 'description') ?? '',
    locale: optionalString(page.locale, 'locale') ?? 'en',
    tags: tagsInput(page.tags),
    isPublished: Boolean(page.isPublished),
    isPrivate: Boolean(page.isPrivate),
    editor: optionalString(page.editor, 'editor') ?? 'markdown'
  };
}

function tagsInput(tags) {
  if (tags === undefined) {
    return [];
  }
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
    badRequest('tags must be an array of strings.');
  }
  return tags;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    badRequest(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    badRequest(`${name} must be a string.`);
  }
  return value;
}

function optionalInteger(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  if (!Number.isInteger(value)) {
    badRequest(`${name} must be an integer.`);
  }
  return value;
}

function regexFromInput(pattern, flags) {
  validateRegexFlags(flags);
  try {
    return new RegExp(pattern, flags);
  } catch (cause) {
    badRequest(`invalid regex: ${cause.message}`);
  }
}

function countRegexMatches(value, pattern, flags) {
  if (!flags.includes('g')) {
    return regexFromInput(pattern, flags).test(value) ? 1 : 0;
  }

  const expression = regexFromInput(pattern, flags.replace('y', ''));
  let count = 0;
  let match;
  while ((match = expression.exec(value)) !== null) {
    count += 1;
    if (match[0] === '') {
      expression.lastIndex += 1;
    }
  }
  return count;
}

function validateRegexFlags(flags) {
  if (!/^[dgimsuvy]*$/.test(flags)) {
    badRequest('flags must contain only JavaScript RegExp flags: d, g, i, m, s, u, v, y.');
  }
  if (new Set(flags).size !== flags.length) {
    badRequest('flags must not contain duplicates.');
  }
}

function firstChangedLineDiff(before, after) {
  if (before === after) {
    return null;
  }

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      return {
        line: index + 1,
        before: beforeLines[index] ?? '',
        after: afterLines[index] ?? ''
      };
    }
  }

  return null;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

async function wikiGraphql(query, variables) {
  if (!wikiApiToken) {
    const error = new Error('WIKIJS_API_TOKEN is not configured');
    error.statusCode = 503;
    throw error;
  }

  if (typeof query !== 'string' || query.trim() === '') {
    const error = new Error('query must be a non-empty string');
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(wikiGraphqlUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${wikiApiToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok || body.errors) {
    const error = new Error(`wikijs_graphql_failed: ${JSON.stringify(body)}`);
    error.statusCode = response.ok ? 502 : response.status;
    throw error;
  }

  return body.data;
}

function isOpenApiPath(pathname) {
  return pathname === '/openapi.json'
    || pathname === '/.well-known/openapi.json';
}

function openApiDocument(req, mode) {
  const origin = publicOriginUrl(req);
  const paths = mode === 'mcp-action'
    ? {
        '/mcp': actionPath({
          operationId: 'callWikiAction',
          summary: 'Call a Wiki.js action',
          schema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: [
                  'searchPages',
                  'getPage',
                  'searchAndGetPage',
                  'search_and_get_page',
                  'getPageByTitle',
                  'get_page_by_title',
                  'listPages',
                  'createPage',
                  'bulkCreatePages',
                  'updatePage',
                  'replaceRegex',
                  'replace_regex',
                  'movePage',
                  'bulkMovePages',
                  'deletePage',
                  'bulkDeletePages',
                  'runGraphql'
                ]
              },
              arguments: {
                type: 'object',
                additionalProperties: true,
                description: 'Arguments for the selected action.'
              }
            },
            required: ['action', 'arguments']
          }
        })
      }
    : restOpenApiPaths();

  return {
    openapi: '3.1.0',
    info: {
      title: 'Wiki.js Actions API',
      version: '0.1.0',
      description: 'Search, read, create, update, and delete Wiki.js pages.'
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' }
              }
            }
          }
        },
        PageSelector: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            path: { type: 'string' },
            locale: { type: 'string', default: 'en' }
          }
        },
        PageSearch: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            locale: { type: 'string', default: 'en' },
            pathPrefix: { type: 'string' },
            limit: { type: 'integer', default: 10 },
            orderBy: { type: 'string', enum: ['updatedAt', 'createdAt'] }
          },
          required: ['query']
        },
        PageTitleSelector: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            locale: { type: 'string', default: 'en' }
          },
          required: ['title']
        },
        PageList: {
          type: 'object',
          properties: {
            locale: { type: 'string', default: 'en' },
            pathPrefix: { type: 'string' },
            limit: { type: 'integer', default: 50 },
            orderBy: { type: 'string', enum: ['updatedAt', 'createdAt'] }
          }
        },
        PageInput: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            description: { type: 'string', default: '' },
            locale: { type: 'string', default: 'en' },
            tags: { type: 'array', items: { type: 'string' }, default: [] },
            isPublished: { type: 'boolean', default: true },
            isPrivate: { type: 'boolean', default: false },
            editor: { type: 'string', default: 'markdown' }
          },
          required: ['path', 'title', 'content']
        },
        PagePatch: {
          allOf: [
            { $ref: '#/components/schemas/PageSelector' },
            {
              type: 'object',
              properties: {
                title: { type: 'string' },
                content: { type: 'string' },
                description: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                isPublished: { type: 'boolean' },
                isPrivate: { type: 'boolean' },
                editor: { type: 'string' }
              }
            }
          ]
        },
        RegexReplacement: {
          type: 'object',
          properties: {
            page_id: { type: 'integer' },
            pattern: { type: 'string' },
            replacement: { type: 'string' },
            flags: { type: 'string', default: 'g' },
            locale: { type: 'string', default: 'en' }
          },
          required: ['page_id', 'pattern', 'replacement']
        },
        BulkCreate: {
          type: 'object',
          properties: {
            pages: { type: 'array', items: { $ref: '#/components/schemas/PageInput' } },
            continueOnError: { type: 'boolean', default: true }
          },
          required: ['pages']
        },
        MoveSelector: {
          allOf: [
            { $ref: '#/components/schemas/PageSelector' },
            {
              type: 'object',
              properties: {
                destinationPath: { type: 'string' },
                destinationLocale: { type: 'string' }
              },
              required: ['destinationPath']
            }
          ]
        },
        BulkMove: {
          type: 'object',
          properties: {
            moves: { type: 'array', items: { $ref: '#/components/schemas/MoveSelector' } },
            continueOnError: { type: 'boolean', default: true }
          },
          required: ['moves']
        },
        BulkDelete: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'integer' } },
            paths: { type: 'array', items: { type: 'string' } },
            locale: { type: 'string', default: 'en' },
            continueOnError: { type: 'boolean', default: true }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }],
    paths
  };
}

function restOpenApiPaths() {
  return {
    '/api/pages/search': actionPath({
      operationId: 'searchWikiPages',
      summary: 'Search Wiki.js pages',
      schema: { $ref: '#/components/schemas/PageSearch' }
    }),
    '/api/pages/get': actionPath({
      operationId: 'getWikiPage',
      summary: 'Get a Wiki.js page by path or ID',
      schema: { $ref: '#/components/schemas/PageSelector' }
    }),
    '/api/pages/search_and_get': actionPath({
      operationId: 'searchAndGetWikiPage',
      summary: 'Search Wiki.js pages and get the full page for one strong match',
      schema: { $ref: '#/components/schemas/PageSearch' }
    }),
    '/api/pages/get_by_title': actionPath({
      operationId: 'getWikiPageByTitle',
      summary: 'Get a Wiki.js page by title',
      schema: { $ref: '#/components/schemas/PageTitleSelector' }
    }),
    '/api/pages/list': actionPath({
      operationId: 'listWikiPages',
      summary: 'List Wiki.js pages',
      schema: { $ref: '#/components/schemas/PageList' }
    }),
    '/api/pages/create': actionPath({
      operationId: 'createWikiPage',
      summary: 'Create a Wiki.js page',
      schema: { $ref: '#/components/schemas/PageInput' }
    }),
    '/api/pages/bulk_create': actionPath({
      operationId: 'bulkCreateWikiPages',
      summary: 'Create multiple Wiki.js pages',
      schema: { $ref: '#/components/schemas/BulkCreate' }
    }),
    '/api/pages/update': actionPath({
      operationId: 'updateWikiPage',
      summary: 'Update a Wiki.js page by path or ID',
      schema: { $ref: '#/components/schemas/PagePatch' }
    }),
    '/api/pages/replace_regex': actionPath({
      operationId: 'replaceWikiPageRegex',
      summary: 'Replace text in a Wiki.js page using a regular expression',
      schema: { $ref: '#/components/schemas/RegexReplacement' }
    }),
    '/api/pages/move': actionPath({
      operationId: 'moveWikiPage',
      summary: 'Move a Wiki.js page by path or ID to a new path and/or locale',
      schema: { $ref: '#/components/schemas/MoveSelector' }
    }),
    '/api/pages/bulk_move': actionPath({
      operationId: 'bulkMoveWikiPages',
      summary: 'Move multiple Wiki.js pages',
      schema: { $ref: '#/components/schemas/BulkMove' }
    }),
    '/api/pages/delete': actionPath({
      operationId: 'deleteWikiPage',
      summary: 'Delete a Wiki.js page by path or ID',
      schema: { $ref: '#/components/schemas/PageSelector' }
    }),
    '/api/pages/bulk_delete': actionPath({
      operationId: 'bulkDeleteWikiPages',
      summary: 'Delete multiple Wiki.js pages by ID and/or path',
      schema: { $ref: '#/components/schemas/BulkDelete' }
    }),
    '/api/graphql': actionPath({
      operationId: 'runWikiGraphql',
      summary: 'Run a Wiki.js GraphQL query or mutation',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          variables: { type: 'object', additionalProperties: true }
        },
        required: ['query']
      }
    })
  };
}

function actionPath({ operationId, summary, schema }) {
  return {
    post: {
      operationId,
      summary,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema
          }
        }
      },
      responses: {
        200: {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true
              }
            }
          }
        },
        400: {
          description: 'Bad request',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        401: {
          description: 'Missing or invalid bearer token',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        }
      }
    }
  };
}

function publicOriginUrl(req) {
  return configuredPublicUrl || originUrl(req);
}

function originUrl(req) {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const proto = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const host = forwardedHost || req.headers.host || `localhost:${port}`;
  return `${proto}://${host}`;
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0]?.split(',')[0]?.trim();
  }
  return value?.split(',')[0]?.trim();
}

function mcpText(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) {
    const error = new Error('empty request body');
    error.statusCode = 400;
    throw error;
  }

  return JSON.parse(body);
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
