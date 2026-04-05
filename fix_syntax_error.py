import re


with open('services/neuralEngine.js', 'r') as f:
    content = f.read()

# Fix the missing else block - add closing brace and else before console.error
pattern = r"(return true;\n        }\n\n      console\.error\('❌ LM Studio not responding)"
replacement = "return true;\n        } else {\n          console.error('❌ LM Studio not responding"

content = re.sub(pattern, replacement, content)

with open('services/neuralEngine.js', 'w') as f:
    f.write(content)

print("✅ Fixed syntax error in neuralEngine.js")