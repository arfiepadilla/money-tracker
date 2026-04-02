
import io
import csv
from typing import List, Dict, Any
from flask import Flask, request, jsonify
from flask_cors import CORS


app = Flask(__name__)
CORS(app)

def categorize_transaction(row: Dict[str, str]) -> Dict[str, Any]:
    total = float(row.get('Total', '0') or '0')
    transaction_type = row.get('Transaction Type', '').strip().lower()
    category = row.get('Category', '').strip().lower()
    payee = row.get('Payee', '').strip().lower()

    # Rule 1: Positive total = income
    if total > 0:
        main_type = 'Income'
        sub_type = row.get('Category', '').strip() if row.get('Category', '').strip() else row.get('Payee', '').strip()
    else:
        # Rule 2: Check Transaction Type first
        if 'investment' in transaction_type or 'invest' in category or 'stock' in category or '401' in category or 'brokerage' in category or 'retirement' in category or 'pension' in category:
            main_type = 'Investment'
        elif 'transfer' in transaction_type or 'save' in category or 'savings' in category or 'save' in transaction_type:
            main_type = 'Savings'
        elif 'purchase' in transaction_type or 'payment' in transaction_type or 'debit' in transaction_type or 'expense' in category:
            main_type = 'Expense'
        else:
            # Default to expense for negative amounts
            main_type = 'Expense'
        
        sub_type = row.get('Category', '').strip() if row.get('Category', '').strip() else row.get('Payee', '').strip()

    return {
        'Transaction Type': row.get('Transaction Type', '').strip(),
        'Payee': row.get('Payee', '').strip(),
        'Category': row.get('Category', '').strip(),
        'Total': total,
        'MainType': main_type,
        'SubType': sub_type
    }

@app.route('/api/upload-csv', methods=['POST'])
def upload_csv():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    try:
        stream = io.StringIO(file.stream.read().decode('utf-8'))
        reader = csv.DictReader(stream)
        transactions = [categorize_transaction(row) for row in reader]
        return jsonify({'transactions': transactions})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
