import requests
import json

# Test transpose by lines
print("Testing transpose_by_lines...")
url = "http://127.0.0.1:8796/tools/transpose_by_lines/execute"

data = {
    "arguments": {"text": "ABC\nDEF\nGHI"}
}

try:
    response = requests.post(url, json=data)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
except Exception as e:
    print(f"Error: {e}")

# Test transpose by words
print("\n\nTesting transpose_by_words...")
url2 = "http://127.0.0.1:8796/tools/transpose_by_words/execute"

data2 = {
    "arguments": {"text": "hello world"}
}

try:
    response2 = requests.post(url2, json=data2)
    print(f"Status: {response2.status_code}")
    print(f"Response: {json.dumps(response2.json(), indent=2)}")
except Exception as e:
    print(f"Error: {e}")
