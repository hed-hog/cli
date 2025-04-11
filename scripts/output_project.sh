#!/bin/bash
# Sair imediatamente se ocorrer algum erro
set -e

# Verifica se o diretório foi passado como argumento
if [ "$#" -ne 1 ]; then
    echo "Uso: $0 <project-directory>"
    exit 1
fi

# Define o diretório base
DIR="$1"

# Verifica se o diretório existe
if [ ! -d "$DIR" ]; then
    echo "Erro: O diretório '$DIR' não existe."
    exit 1
fi

# Obtém o nome do projeto a partir do package.json, se existir
PACKAGE_JSON="$DIR/package.json"
if [ -f "$PACKAGE_JSON" ]; then
    PROJECT_NAME=$(grep -oP '"name"\s*:\s*"\K[^"]+' "$PACKAGE_JSON")
else
    PROJECT_NAME="Unknown Project"
fi

# Exibe o cabeçalho com o título do projeto
echo "# Listagem de arquivos \`.ts\` e \`.ejs\` do projeto \`$PROJECT_NAME\`"
echo

# Encontra arquivos .ts e .ejs ignorando o diretório node_modules
find "$DIR" \( -type d -name "node_modules" -prune \) -o \( -type f \( -name "*.ts" -o -name "*.ejs" \) -print \) | grep -v "/node_modules/" | while read -r FILE; do
    echo "## \`$FILE\`"
    echo
    
    # Detecta a extensão e define a sintaxe adequada para a highlighting
    FILE_EXT="${FILE##*.}"
    if [ "$FILE_EXT" == "ts" ]; then
        echo '```ts'
        elif [ "$FILE_EXT" == "ejs" ]; then
        echo '```ejs'
    else
        echo '```'
    fi
    
    cat "$FILE"
    echo '```'
    echo
done

exit 0
