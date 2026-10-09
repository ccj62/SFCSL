# SFCSL

SFCSL er et tekstsprog til at beskrive sekvensdiagrammer (SFC) med trin (`S1`, `S2` …), transitioner (`t1`, `t2` …), alternative grene `( … )`, parallelle grene `[ … ]` og hop `>> Sx`.

## SFCSL Mermaid-editor

`sfcsl-mermaid-editor.html` er en enkelt HTML-fil, der kører i browseren. Den oversætter et SFCSL-program, du skriver i editoren, til Mermaid-kode og tegner diagrammet nedenunder.

- To stilarter: tilstandsdiagram (`stateDiagram-v2` med fork/join) og flowchart (med SFC-agtige parallelbjælker).
- Validerer programmet og viser fejl, for eksempel dobbelte navne eller hop ind i eller ud af en parallel gren.
- Mermaid-koden kan kopieres ind i et dokument, en wiki eller en pull request.

Åbn filen direkte i en browser. Den henter Mermaid fra cdnjs, så den skal have netadgang.

## SFCSL i Google Sheets

Mappen `google-sheets/` indeholder et Google Apps Script, der læser SFCSL fra ét ark og tegner SFC-diagrammet med celler og kanter i et andet ark. Se [google-sheets/README.md](google-sheets/README.md) for installation.
