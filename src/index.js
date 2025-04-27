// Cloudflare Worker KV Manager (Enhanced)
// This worker renders a UI to browse KV namespaces and their data

// HTML template for the application
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare KV Manager</title>
  <style>
    * {
      box-sizing: border-box;
      font-family: Arial, sans-serif;
    }
    body {
      margin: 0;
      padding: 0;
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    #sidebar {
      width: 250px;
      background-color: #f7f7f7;
      border-right: 1px solid #ddd;
      overflow-y: auto;
      padding: 16px;
      flex-shrink: 0;
      transition: transform 0.3s ease;
      height: 100vh;
      position: absolute;
      left: 0;
      z-index: 10;
    }
    #sidebar.hidden {
      transform: translateX(-250px);
    }
    #main {
      flex-grow: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      margin-left: 250px;
      transition: margin-left 0.3s ease;
      width: calc(100vw - 250px);
    }
    #main.full {
      margin-left: 0;
      width: 100vw;
    }
    .namespace-item {
      padding: 8px 12px;
      margin-bottom: 6px;
      background-color: #e9e9e9;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.2s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .namespace-item:hover {
      background-color: #d1d1d1;
    }
    .namespace-item.active {
      background-color: #0051c3;
      color: white;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .title-section {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 500px;
    }
    .actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    #hamburger {
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 18px;
      width: 24px;
      background: none;
      border: none;
      padding: 0;
    }
    #hamburger span {
      display: block;
      height: 2px;
      width: 24px;
      background-color: #333;
      transition: transform 0.3s ease;
    }
    #search {
      padding: 6px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      width: 220px;
    }
    #download-btn {
      padding: 8px 16px;
      background-color: #0051c3;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      display: none;
    }
    #download-btn:hover {
      background-color: #003d96;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px 12px;
      text-align: left;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    th {
      background-color: #f2f2f2;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    #pagination {
      margin-top: 16px;
      display: flex;
      justify-content: center;
      gap: 8px;
      align-items: center;
    }
    .page-btn {
      padding: 4px 10px;
      background-color: #e9e9e9;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .page-btn.active {
      background-color: #0051c3;
      color: white;
    }
    .page-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .loader {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #0051c3;
      border-radius: 50%;
      width: 30px;
      height: 30px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .nested-table {
      margin-top: 6px;
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 2px;
      background-color: #f5f5f5;
      max-height: 200px;
      overflow-y: auto;
    }
    .nested-table table {
      background-color: white;
    }
    td.expandable {
      cursor: pointer;
      color: #0051c3;
    }
    td.expandable:hover {
      text-decoration: underline;
    }
    .no-results {
      text-align: center;
      padding: 20px;
      color: #666;
    }
  </style>
</head>
<body>
  <div id="sidebar">
    <h2>KV Namespaces</h2>
    <div id="namespaces-list">
      <div class="loader"></div>
    </div>
  </div>
  <div id="main">
    <div class="header">
      <div class="title-section">
        <button id="hamburger">
          <span></span>
          <span></span>
          <span></span>
        </button>
        <h1 id="current-namespace">Select a KV Namespace</h1>
      </div>
      <div class="actions">
        <input type="text" id="search" placeholder="Search data..." />
        <button id="download-btn">Download CSV</button>
      </div>
    </div>
    <div id="kv-data">
      <p>Please select a namespace from the sidebar to view its data.</p>
    </div>
    <div id="pagination"></div>
  </div>

  <script>
    // State management
    let currentNamespace = null;
    let allData = [];
    let filteredData = [];
    let currentPage = 1;
    const itemsPerPage = 30;
    let sidebarVisible = true;
    
    // When DOM is loaded
    document.addEventListener('DOMContentLoaded', async () => {
      // Load namespaces
      await loadNamespaces();
      
      // Set up event listeners
      document.getElementById('download-btn').addEventListener('click', downloadCsv);
      document.getElementById('hamburger').addEventListener('click', toggleSidebar);
      document.getElementById('search').addEventListener('input', handleSearch);
      
      // Check screen size and maybe hide sidebar by default on mobile
      if (window.innerWidth < 768) {
        toggleSidebar();
      }
    });
    
    // Toggle sidebar visibility
    function toggleSidebar() {
      sidebarVisible = !sidebarVisible;
      document.getElementById('sidebar').classList.toggle('hidden', !sidebarVisible);
      document.getElementById('main').classList.toggle('full', !sidebarVisible);
    }
    
    // Handle search input
    function handleSearch() {
      const searchTerm = document.getElementById('search').value.toLowerCase();
      
      if (!searchTerm) {
        filteredData = [...allData];
      } else {
        filteredData = allData.filter(item => {
          // Search in all string properties
          return Object.entries(item).some(([key, value]) => {
            if (typeof value === 'string') {
              return value.toLowerCase().includes(searchTerm);
            } else if (typeof value === 'object' && value !== null) {
              // Search in JSON objects too
              return JSON.stringify(value).toLowerCase().includes(searchTerm);
            }
            return String(value).toLowerCase().includes(searchTerm);
          });
        });
      }
      
      // Reset to first page and render
      currentPage = 1;
      renderData();
    }
    
    // Load KV namespaces
    async function loadNamespaces() {
      try {
        const response = await fetch('/api/list-namespaces');
        if (!response.ok) throw new Error('Failed to fetch namespaces');
        
        const namespaces = await response.json();
        renderNamespaces(namespaces);
      } catch (error) {
        console.error('Error loading namespaces:', error);
        document.getElementById('namespaces-list').innerHTML = 
          '<div class="error">Error loading namespaces. Please try again.</div>';
      }
    }
    
    // Render namespaces in sidebar
    function renderNamespaces(namespaces) {
      const container = document.getElementById('namespaces-list');
      
      if (!namespaces || namespaces.length === 0) {
        container.innerHTML = '<p>No KV namespaces found.</p>';
        return;
      }
      
      let html = '';
      for (const namespace of namespaces) {
        html += '<div class="namespace-item" data-id="' + namespace.id + '" title="' + namespace.title + '">' + namespace.title + '</div>';
      }
      
      container.innerHTML = html;
      
      // Add click listeners
      document.querySelectorAll('.namespace-item').forEach(item => {
        item.addEventListener('click', () => {
          document.querySelectorAll('.namespace-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          const namespaceId = item.getAttribute('data-id');
          loadNamespaceData(namespaceId, item.textContent);
          
          // On mobile, hide sidebar after selection
          if (window.innerWidth < 768) {
            toggleSidebar();
          }
        });
      });
    }
    
    // Load data for a specific namespace
    async function loadNamespaceData(namespaceId, namespaceName) {
      currentNamespace = namespaceId;
      currentPage = 1;
      document.getElementById('current-namespace').textContent = namespaceName;
      document.getElementById('current-namespace').title = namespaceName;
      document.getElementById('kv-data').innerHTML = '<div class="loader"></div>';
      document.getElementById('download-btn').style.display = 'block';
      document.getElementById('search').value = '';
      
      try {
        const response = await fetch('/api/kv-data/' + namespaceId);
        if (!response.ok) throw new Error('Failed to fetch KV data');
        
        allData = await response.json();
        filteredData = [...allData];
        renderData();
      } catch (error) {
        console.error('Error loading KV data:', error);
        document.getElementById('kv-data').innerHTML = 
          '<div class="error">Error loading KV data. Please try again.</div>';
      }
    }
    
    // Render data table with pagination
    function renderData() {
      if (filteredData.length === 0 && document.getElementById('search').value) {
        document.getElementById('kv-data').innerHTML = '<div class="no-results">No results match your search.</div>';
        document.getElementById('pagination').innerHTML = '';
        return;
      }
      
      const totalPages = Math.ceil(filteredData.length / itemsPerPage);
      const start = (currentPage - 1) * itemsPerPage;
      const end = start + itemsPerPage;
      const pageData = filteredData.slice(start, end);
      
      renderTable(pageData);
      renderPagination(totalPages);
    }
    
    // Determine if a value is a JSON object that should be expanded
    function isExpandableJson(value) {
      return (
        typeof value === 'object' && 
        value !== null && 
        !Array.isArray(value) &&
        Object.keys(value).length > 0
      );
    }
    
    // Render data table
    function renderTable(data) {
      if (!data || data.length === 0) {
        document.getElementById('kv-data').innerHTML = '<p>No data in this namespace.</p>';
        return;
      }
      
      // Create table header - we always include key, expiration, metadata columns
      let html = '<table><thead><tr>';
      html += '<th>key</th>';
      
      // Detect expandable JSON values and build header structure
      let hasJsonValues = false;
      let jsonColumns = new Set();
      
      data.forEach(row => {
        if (row.value && isExpandableJson(row.value)) {
          hasJsonValues = true;
          // Collect all potential JSON columns
          Object.keys(row.value).forEach(key => jsonColumns.add(key));
        }
      });
      
      // If we have JSON values, add those columns
      if (hasJsonValues) {
        jsonColumns = Array.from(jsonColumns).sort();
        jsonColumns.forEach(column => {
          html += '<th>' + column + '</th>';
        });
      } else {
        // Otherwise just show the value column
        html += '<th>value</th>';
      }
      
      // Always add expiration and metadata
      html += '<th>expiration</th>';
      html += '<th>metadata</th>';
      html += '</tr></thead><tbody>';
      
      // Render rows
      data.forEach(row => {
        html += '<tr>';
        
        // Key column
        html += '<td>' + row.key + '</td>';
        
        // Handle JSON values
        if (hasJsonValues) {
          if (row.value && isExpandableJson(row.value)) {
            // For each JSON column
            jsonColumns.forEach(column => {
              const cellValue = row.value[column];
              if (cellValue === undefined) {
                html += '<td></td>';
              } else if (isExpandableJson(cellValue)) {
                html += '<td class="expandable" title="Click to expand">{ ... }</td>';
              } else {
                html += '<td>' + (typeof cellValue === 'string' ? cellValue : JSON.stringify(cellValue)) + '</td>';
              }
            });
          } else {
            // Fill empty cells for non-JSON values
            jsonColumns.forEach(() => {
              html += '<td></td>';
            });
          }
        } else {
          // Basic value display
          const value = row.value !== undefined ? row.value : '';
          if (isExpandableJson(value)) {
            html += '<td class="expandable" title="Click to expand">{ ... }</td>';
          } else {
            html += '<td>' + (typeof value === 'string' ? value : JSON.stringify(value)) + '</td>';
          }
        }
        
        // Expiration and metadata
        html += '<td>' + (row.expiration || '') + '</td>';
        html += '<td>' + (row.metadata ? JSON.stringify(row.metadata) : '') + '</td>';
        
        html += '</tr>';
      });
      
      html += '</tbody></table>';
      document.getElementById('kv-data').innerHTML = html;
      
      // Add click handler for expandable cells
      document.querySelectorAll('td.expandable').forEach(cell => {
        cell.addEventListener('click', function() {
          const rowIndex = this.closest('tr').rowIndex - 1; // -1 for header row
          const columnName = document.querySelector('table thead th:nth-child(' + (this.cellIndex + 1) + ')').textContent;
          
          // Get the data for this cell
          const rowData = data[rowIndex];
          let cellData;
          
          if (columnName === 'value') {
            cellData = rowData.value;
          } else if (rowData.value && rowData.value[columnName]) {
            cellData = rowData.value[columnName];
          }
          
          if (!cellData) return;
          
          // If already expanded, collapse
          if (this.nextElementSibling && this.nextElementSibling.classList.contains('nested-table')) {
            this.parentNode.removeChild(this.nextElementSibling);
            return;
          }
          
          // Create nested table
          const nestedTable = document.createElement('tr');
          nestedTable.className = 'nested-table';
          nestedTable.innerHTML = '<td colspan="' + this.parentNode.children.length + '">';
          
          let nestedHtml = '<table><thead><tr><th>Property</th><th>Value</th></tr></thead><tbody>';
          
          for (const [key, value] of Object.entries(cellData)) {
            nestedHtml += '<tr>';
            nestedHtml += '<td>' + key + '</td>';
            nestedHtml += '<td>' + (typeof value === 'object' ? JSON.stringify(value) : value) + '</td>';
            nestedHtml += '</tr>';
          }
          
          nestedHtml += '</tbody></table>';
          nestedTable.children[0].innerHTML = nestedHtml;
          
          this.parentNode.parentNode.insertBefore(nestedTable, this.parentNode.nextSibling);
        });
      });
    }
    
    // Render pagination controls
    function renderPagination(totalPages) {
      const container = document.getElementById('pagination');
      
      if (totalPages <= 1) {
        container.innerHTML = '';
        return;
      }
      
      let html = '';
      
      // Previous button
      html += '<button class="page-btn prev"' + (currentPage === 1 ? ' disabled' : '') + '>Previous</button>';
      
      // Page numbers
      let startPage = Math.max(1, currentPage - 2);
      let endPage = Math.min(totalPages, startPage + 4);
      
      if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
      }
      
      for (let i = startPage; i <= endPage; i++) {
        html += '<button class="page-btn page-num ' + (i === currentPage ? 'active' : '') + '" data-page="' + i + '">' + i + '</button>';
      }
      
      // Next button
      html += '<button class="page-btn next"' + (currentPage === totalPages ? ' disabled' : '') + '>Next</button>';
      
      container.innerHTML = html;
      
      // Add event listeners
      document.querySelectorAll('.page-btn.page-num').forEach(btn => {
        btn.addEventListener('click', () => {
          currentPage = parseInt(btn.getAttribute('data-page'));
          renderData();
        });
      });
      
      const prevBtn = document.querySelector('.page-btn.prev');
      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          if (currentPage > 1) {
            currentPage--;
            renderData();
          }
        });
      }
      
      const nextBtn = document.querySelector('.page-btn.next');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (currentPage < totalPages) {
            currentPage++;
            renderData();
          }
        });
      }
    }
    
    // Download data as CSV
    function downloadCsv() {
      if (!allData || allData.length === 0) return;
      
      // Use filtered data if search is active
      const dataToExport = document.getElementById('search').value ? filteredData : allData;
      
      // Check if we have JSON values
      let hasJsonValues = false;
      let jsonColumns = new Set();
      
      dataToExport.forEach(row => {
        if (row.value && isExpandableJson(row.value)) {
          hasJsonValues = true;
          Object.keys(row.value).forEach(key => jsonColumns.add(key));
        }
      });
      
      // Create header row
      let columns = ['key'];
      
      if (hasJsonValues) {
        columns = [...columns, ...Array.from(jsonColumns).sort()];
      } else {
        columns.push('value');
      }
      
      columns.push('expiration', 'metadata');
      
      // Create CSV content
      let csvContent = columns.join(',') + '\\n';
      
      dataToExport.forEach(row => {
        let rowData = [row.key];
        
        if (hasJsonValues) {
          // Add JSON columns
          Array.from(jsonColumns).sort().forEach(column => {
            if (row.value && isExpandableJson(row.value) && row.value[column] !== undefined) {
              let value = row.value[column];
              if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\\n'))) {
                rowData.push('"' + value.replace(/"/g, '""') + '"');
              } else if (typeof value === 'object') {
                rowData.push('"' + JSON.stringify(value).replace(/"/g, '""') + '"');
              } else {
                rowData.push(value);
              }
            } else {
              rowData.push('');
            }
          });
        } else {
          // Add simple value
          let value = row.value;
          if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\\n'))) {
            rowData.push('"' + value.replace(/"/g, '""') + '"');
          } else if (typeof value === 'object') {
            rowData.push('"' + JSON.stringify(value).replace(/"/g, '""') + '"');
          } else {
            rowData.push(value);
          }
        }
        
        // Add expiration and metadata
        rowData.push(row.expiration || '');
        rowData.push(row.metadata ? '"' + JSON.stringify(row.metadata).replace(/"/g, '""') + '"' : '');
        
        csvContent += rowData.join(',') + '\\n';
      });
      
      // Create download link
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const namespaceName = document.getElementById('current-namespace').textContent;
      
      link.setAttribute('href', url);
      link.setAttribute('download', namespaceName.replace(/\\s+/g, '_') + '_data.csv');
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  </script>
</body>
</html>
`;

// Worker entry point
addEventListener('fetch', event => {
	event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
	const url = new URL(request.url);

	// API endpoints for fetching data
	if (url.pathname.startsWith('/api/')) {
		return handleApiRequest(url.pathname, request);
	}

	// Return the main HTML page for everything else
	return new Response(HTML_TEMPLATE, {
		headers: {
			'Content-Type': 'text/html',
			'Cache-Control': 'no-cache'
		}
	});
}

async function handleApiRequest(pathname, request) {
	// Get the list of KV namespaces
	if (pathname === '/api/list-namespaces') {
		try {
			// This requires appropriate permissions in your worker
			const namespaces = await listKVNamespaces();
			return jsonResponse(namespaces);
		} catch (error) {
			return errorResponse('Failed to list KV namespaces', 500);
		}
	}

	// Get data from a specific KV namespace
	if (pathname.startsWith('/api/kv-data/')) {
		const namespaceId = pathname.split('/api/kv-data/')[1];

		if (!namespaceId) {
			return errorResponse('Namespace ID is required', 400);
		}

		try {
			const data = await getKVData(namespaceId);
			return jsonResponse(data);
		} catch (error) {
			return errorResponse(`Failed to get KV data: ${error.message}`, 500);
		}
	}

	return errorResponse('Not found', 404);
}

// Helper functions to interact with Cloudflare KV
async function listKVNamespaces() {
	// This requires API Token with appropriate permissions
	const apiToken = getApiToken();
	const accountId = getAccountId();

	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`,
		{
			headers: {
				'Authorization': `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			}
		}
	);

	if (!response.ok) {
		throw new Error(`API error: ${response.status}`);
	}

	const result = await response.json();

	if (!result.success) {
		throw new Error('Failed to list namespaces');
	}

	return result.result.map(ns => ({
		id: ns.id,
		title: ns.title
	}));
}

async function getKVData(namespaceId) {
	// This requires API Token with appropriate permissions
	const apiToken = getApiToken();
	const accountId = getAccountId();
	const limit = 1000; // Maximum allowed by Cloudflare API
	let cursor = null;
	let allKeys = [];

	// Fetch all keys (paginated)
	do {
		const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`);
		url.searchParams.append('limit', limit.toString());
		if (cursor) {
			url.searchParams.append('cursor', cursor);
		}

		const response = await fetch(url.toString(), {
			headers: {
				'Authorization': `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			}
		});

		if (!response.ok) {
			throw new Error(`API error: ${response.status}`);
		}

		const result = await response.json();

		if (!result.success) {
			throw new Error('Failed to list keys');
		}

		allKeys = [...allKeys, ...result.result];
		cursor = result.result_info.cursor;
	} while (cursor);

	// Fetch values for all keys
	const data = [];
	for (const key of allKeys) {
		try {
			const valueResponse = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key.name)}`,
				{
					headers: {
						'Authorization': `Bearer ${apiToken}`,
						'Content-Type': 'application/json'
					}
				}
			);

			if (!valueResponse.ok) {
				console.error(`Failed to fetch value for key ${key.name}: ${valueResponse.status}`);
				continue;
			}

			let value;
			try {
				// Try to parse as JSON
				value = await valueResponse.json();
			} catch (e) {
				// If not JSON, get as text
				value = await valueResponse.text();
			}

			data.push({
				key: key.name,
				value: value,
				expiration: key.expiration ? new Date(key.expiration * 1000).toISOString() : null,
				metadata: key.metadata || null
			});
		} catch (error) {
			console.error(`Error fetching value for key ${key.name}:`, error);
		}
	}

	return data;
}

// Helper for getting API token from environment or secrets
function getApiToken() {
	// You should set this in your Worker environment variables
	return CLOUDFLARE_API_TOKEN;
}

// Helper for getting account ID from environment or secrets
function getAccountId() {
	// You should set this in your Worker environment variables
	return CLOUDFLARE_ACCOUNT_ID;
}

// Response helpers
function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-cache'
		}
	});
}

function errorResponse(message, status = 400) {
	return jsonResponse({ error: message }, status);
}