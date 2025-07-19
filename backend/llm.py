import requests
import os
import re
import json

def extract_filter_with_llm(user_query):
    """Use Hugging Face LLM to extract filter criteria from natural language"""
        
    # Try pattern matching for natural language to save on api credits
    # nlp_result = extract_filter_nlp_patterns(user_query)
    # if nlp_result:
    #     print(f"NLP pattern matching worked: {nlp_result}")
    #     return nlp_result
    

    hf_token = os.getenv('HUGGINGFACE_API_TOKEN')
    if not hf_token:
        print("Warning: No Hugging Face API token found, all parsing methods failed")
        return None

    print(f"Using LLM to parse: {user_query}")

    api_url = "https://router.huggingface.co/hf-inference/models/HuggingFaceTB/SmolLM3-3B/v1/chat/completions"

    prompt = f"""You are a helpful assistant. Convert the following natural language filter query to a JSON object.
    
Query: "{user_query}"

Available attributes:
- height (building height in meters)
- rooftop_elev_z (roof elevation above sea level)
- grd_elev_min_z (min ground elevation above sea level)
- grd_elev_max_z (max ground elevation above sea level)
- land_use (land use type / land code of the building)

- larger,bigger,above,taller, greater than: >
- smaller,shorter,below,less than: <
- is: ==

Respond only with JSON like: {{"attribute": "height", "operator": ">", "value": 100}}"""

    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json"
    }

    payload = {
        "messages": [
            {
                "role": "system",
                "content": prompt
            }
        ],
        "model": "HuggingFaceTB/SmolLM3-3B"
    }

    try:
        response = requests.post(api_url, headers=headers, json=payload)
        response.raise_for_status()

        result = response.json()
        print("Raw output:", result)

        # Extract content
        content = result['choices'][0]['message']['content']

        # Use regex to extract JSON block inside triple backticks
        match = re.search(r'```json\s*(\{.*?\})\s*```', content, re.DOTALL)
        if match:
            json_str = match.group(1)
            try:
                parsed = json.loads(json_str)
                print(parsed)
                # {'attribute': 'height', 'operator': '>', 'value': 50}
                return parsed
            except json.JSONDecodeError as e:
                print("Invalid JSON:", e)
        else:
            print("No JSON found in the content")
    except Exception as e:
        print(f"Error calling Hugging Face API: {e}")

    return None

""" from chatgpt """
def extract_filter_nlp_patterns(user_query):
    """Extract filters using natural language pattern matching"""
    query = user_query.lower().strip()
    
    # Pattern matching for common phrases
    patterns = [
        # "tall buildings" or "height above X" or "above X meters" - use rooftop elevation as proxy for height
        (r'(?:tall|height|elevation).*?(?:above|over|greater than|>)\s*(\d+(?:\.\d+)?)', 'height', '>'),
        (r'(?:above|over)\s*(\d+(?:\.\d+)?)\s*(?:meters?|m)', 'height', '>'),
        # "short buildings" or "height below X"  
        (r'(?:short|low|height|elevation).*?(?:below|under|less than|<)\s*(\d+(?:\.\d+)?)', 'height', '<'),
        (r'(?:below|under)\s*(\d+(?:\.\d+)?)\s*(?:meters?|m)', 'height', '<'),
        # "ground level above X"
        (r'(?:ground|base).*?(?:above|over|>)\s*(\d+(?:\.\d+)?)', 'grd_elev_min_z', '>'),
        # "ground level below X"
        (r'(?:ground|base).*?(?:below|under|<)\s*(\d+(?:\.\d+)?)', 'grd_elev_min_z', '<'),
        # "buildings taller than X"
        (r'(?:buildings?|structures?).*?(?:taller|higher).*?(?:than|>)\s*(\d+(?:\.\d+)?)', 'height', '>'),
        # "buildings shorter than X"
        (r'(?:buildings?|structures?).*?(?:shorter|lower).*?(?:than|<)\s*(\d+(?:\.\d+)?)', 'height', '<'),
        # Simple "X meters" (assume height)
        (r'(\d+(?:\.\d+)?)\s*(?:meters?|m)', 'height', '>'),
    ]
    
    print(f"Trying to match patterns for: '{query}'")
    
    for i, (pattern, attribute, operator) in enumerate(patterns):
        match = re.search(pattern, query)
        if match:
            value = match.group(1)
            result = {
                'attribute': attribute,
                'operator': operator,
                'value': value
            }
            print(f"Pattern {i} matched: {result}")
            return result
    
    print("No patterns matched")
    return None
