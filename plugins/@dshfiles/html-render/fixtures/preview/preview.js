const status = document.getElementById('status')
status.textContent = getComputedStyle(status).color === 'rgb(1, 2, 3)' ? 'stylesheet and script inlined' : 'script inlined only'
