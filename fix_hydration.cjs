const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

const injection = `
    <script>
      (function() {
        try {
          var stateStr = localStorage.getItem('ionity-app-storage');
          var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches; // default
          if (stateStr) {
            var state = JSON.parse(stateStr);
            var theme = state.state?.userAccount?.appTheme;
            if (theme === 'dark') {
              isDark = true;
            } else if (theme === 'light') {
              isDark = false;
            }
          }
          if (isDark) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.add('light');
          }
        } catch (e) {}
      })();
    </script>
  </head>`;

html = html.replace('</head>', injection);
fs.writeFileSync('index.html', html);
