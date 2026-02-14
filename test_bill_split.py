#!/usr/bin/env python3
"""Test the bill splitting prompt with the Thai restaurant scenario"""

import openai
import sys

# Get API key from command line or environment
if len(sys.argv) > 1:
    api_key = sys.argv[1]
else:
    import os
    api_key = os.getenv('OPENAI_API_KEY')

if not api_key:
    print("Usage: python test_bill_split.py <OPENAI_API_KEY>")
    sys.exit(1)

client = openai.OpenAI(api_key=api_key)

# The exact scenario from the user's screenshots
participants = ['Aaron Walters', 'Gina Rhee', 'Arvind Balasundaram']

chat_context = """- Aaron Walters: i had the panda with the N and the kao soy kua neur
- Gina Rhee: I had the To Be Tamarind and Goong Muk Prik Klua
- Aaron Walters: arvind had the jakapat, the white rice, and the kao soy gai
- Aaron Walters: and we split the roti masaman 3 ways"""

# Since we can't use the actual image, we'll describe the receipt in text
# This simulates what the vision API would extract
receipt_text = """Receipt contents:
1 To be Tamarind - $19.00
1 Jakapat - $19.00
1 Panda With The "N" - $19.00
1 Roti Massamun - $16.00
1 Goong Muk Prik Klua - $30.00
1 Kao Soy Kua Neur - $28.00
1 Kao Soy Gai - $28.00
1 White rice - $4.00

Subtotal: $163.00
Tax: $14.47
Tip: $32.60
Total: $210.07"""

system_prompt = f"""Extract bill split data from this receipt. Participants: {', '.join(participants)}

Instructions from chat: {chat_context}

YOUR TASK:
1. Read the receipt to find: subtotal, tax, tip, and total
2. Match each person's items from the chat to items on the receipt
3. Look up the EXACT price of each item from the receipt
4. If an item is "split X ways", divide its price by X for each person's share

OUTPUT ONLY VALID JSON in this exact format:
{{
  "receipt": {{
    "subtotal": 0.00,
    "tax": 0.00,
    "tip": 0.00,
    "total": 0.00
  }},
  "people": [
    {{
      "name": "Person Name",
      "items": [
        {{"name": "Item Name", "price": 0.00}}
      ]
    }}
  ]
}}

RULES:
- Use EXACT prices from the receipt
- For split items, use the divided price (e.g., $16 split 3 ways = $5.33 per person)
- Include the split item for EACH person who shared it
- Output ONLY the JSON, no other text"""

print("=" * 60)
print("TESTING BILL SPLIT PROMPT")
print("=" * 60)
print(f"\nParticipants: {participants}")
print(f"\nChat context:\n{chat_context}")
print(f"\nReceipt:\n{receipt_text}")
print("\n" + "=" * 60)
print("EXPECTED RESULTS:")
print("=" * 60)
print("""
Aaron: Panda ($19) + Kao Soy Kua Neur ($28) + 1/3 Roti ($5.33) = $52.33
  → $52.33 × 1.2886 = $67.44

Gina: To Be Tamarind ($19) + Goong Muk Prik Klua ($30) + 1/3 Roti ($5.33) = $54.33
  → $54.33 × 1.2886 = $70.02

Arvind: Jakapat ($19) + White Rice ($4) + Kao Soy Gai ($28) + 1/3 Roti ($5.33) = $56.33
  → $56.33 × 1.2886 = $72.61

Total: $210.07
""")

print("=" * 60)
print("AI RESPONSE (RAW JSON):")
print("=" * 60)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": receipt_text}
    ],
    max_tokens=1500,
    temperature=0
)

raw_response = response.choices[0].message.content
print(raw_response)

print("\n" + "=" * 60)
print("PYTHON CALCULATION FROM JSON:")
print("=" * 60)

import json

# Extract JSON from response (handle markdown code blocks)
json_str = raw_response
if '```json' in json_str:
    json_str = json_str.split('```json')[1].split('```')[0].strip()
elif '```' in json_str:
    json_str = json_str.split('```')[1].split('```')[0].strip()

try:
    data = json.loads(json_str)
    
    # Extract receipt totals
    receipt = data.get('receipt', {})
    subtotal = float(receipt.get('subtotal', 0))
    tax = float(receipt.get('tax', 0))
    tip = float(receipt.get('tip', 0))
    total = float(receipt.get('total', 0))
    
    print(f"Receipt: subtotal=${subtotal}, tax=${tax}, tip=${tip}, total=${total}")
    print()
    
    # Calculate each person's share
    results = []
    for person in data.get('people', []):
        name = person.get('name', 'Unknown')
        items = person.get('items', [])
        
        # Sum their item prices
        person_subtotal = sum(float(item.get('price', 0)) for item in items)
        item_names = [f"{item.get('name', '')} (${item.get('price', 0)})" for item in items]
        
        # Calculate their percentage of the subtotal
        if subtotal > 0:
            percentage = person_subtotal / subtotal
        else:
            percentage = 0
        
        # Apply percentage to tax and tip
        person_tax = percentage * tax
        person_tip = percentage * tip
        person_total = person_subtotal + person_tax + person_tip
        
        print(f"{name}:")
        print(f"  Items: {', '.join(item_names)}")
        print(f"  Subtotal: ${person_subtotal:.2f} ({percentage*100:.1f}% of bill)")
        print(f"  Tax share: ${person_tax:.2f}")
        print(f"  Tip share: ${person_tip:.2f}")
        print(f"  TOTAL: ${person_total:.2f}")
        print()
        
        results.append({
            'name': name,
            'items': [item.get('name', '') for item in items],
            'total': round(person_total, 2)
        })
    
    # Final output
    print("=" * 60)
    print("FINAL OUTPUT:")
    print("=" * 60)
    items_section = "\n".join([f"- {r['name']}: {', '.join(r['items'])}" for r in results])
    owes_section = "\n".join([f"- {r['name']}: ${r['total']:.2f}" for r in results])
    calculated_total = sum(r['total'] for r in results)
    
    print(f"**Items:**\n{items_section}\n")
    print(f"**Owes:**\n{owes_section}\n")
    print(f"Total: ${calculated_total:.2f}")
    
    print("\n" + "=" * 60)
    print("VERIFICATION:")
    print("=" * 60)
    print(f"Calculated total: ${calculated_total:.2f}")
    print(f"Expected total: $210.07")
    print(f"Difference: ${abs(calculated_total - 210.07):.2f}")
    
    # Find Aaron and Gina's totals
    aaron_total = next((r['total'] for r in results if 'Aaron' in r['name']), 0)
    gina_total = next((r['total'] for r in results if 'Gina' in r['name']), 0)
    print(f"\nAaron owes: ${aaron_total:.2f}")
    print(f"Gina owes: ${gina_total:.2f}")
    if gina_total > aaron_total:
        print("✅ CORRECT: Gina owes more than Aaron (she had the $30 item)")
    else:
        print("❌ WRONG: Gina should owe more than Aaron!")
        
except json.JSONDecodeError as e:
    print(f"JSON parse error: {e}")
    print(f"Attempted to parse: {json_str}")
