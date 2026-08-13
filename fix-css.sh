sed -i 's/  \.dark {/  \.dark body, \.dark body\[data-filter-level="none"\], \.dark body\[data-filter-level="low"\], \.dark body\[data-filter-level="medium"\], \.dark body\[data-filter-level="high"\] {/g' src/index.css
sed -i 's/--glass-border-color: rgba(14, 165, 233, 0.6);/--glass-border-color: rgba(14, 165, 233, 0.6) !important;/g' src/index.css
sed -i 's/--glass-glow: 0 0 16px 2px rgba(14, 165, 233, 0.25);/--glass-glow: 0 0 16px 2px rgba(14, 165, 233, 0.25) !important;/g' src/index.css
