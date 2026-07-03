import sys
import json
import urllib.request
import urllib.error
from datetime import datetime

def make_request(url, method="GET", data=None):
    req = urllib.request.Request(url, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
        json_data = json.dumps(data).encode("utf-8")
    else:
        json_data = None
        
    try:
        with urllib.request.urlopen(req, data=json_data) as response:
            res = response.read().decode("utf-8")
            return json.loads(res)
    except urllib.error.HTTPError as e:
        try:
            err_res = e.read().decode("utf-8")
            return {"error": e.reason, "status_code": e.code, "details": json.loads(err_res)}
        except:
            return {"error": e.reason, "status_code": e.code}
    except Exception as e:
        return {"error": str(e)}

def main():
    if len(sys.argv) < 2:
        print("Usage: python test-api.py [pusat|tasikmalaya|surabaya] [operation]")
        print("Available operations: health, ping, menus, tables, create-order, price-override, submit-report")
        sys.exit(1)
        
    node = sys.argv[1]
    operation = sys.argv[2] if len(sys.argv) > 2 else "health"
    
    ports = {"pusat": 3001, "tasikmalaya": 3002, "surabaya": 3003}
    if node not in ports:
        print(f"Unknown node: {node}")
        sys.exit(1)
        
    port = ports[node]
    base_url = f"http://localhost:{port}"
    
    print(f"Testing LC-DOS API on {node} (port {port})")
    print(f"Operation: {operation}\n")
    
    if operation == "health":
        url = f"{base_url}/health"
        res = make_request(url)
    elif operation == "ping":
        url = f"{base_url}/db/ping"
        res = make_request(url)
    elif operation == "menus":
        url = f"{base_url}/db/global/menus"
        res = make_request(url)
    elif operation == "tables":
        url = f"{base_url}/db/local/tables"
        res = make_request(url)
    elif operation == "create-order":
        url = f"{base_url}/db/local/orders"
        table_id = "33333333-3333-3333-3333-333333333331" if node != "surabaya" else "33333333-3333-3333-3333-333333333332"
        data = {
            "tableId": table_id,
            "items": [
                {
                    "menuId": "22222222-2222-2222-2222-222222222222",
                    "quantity": 2,
                    "specialNote": "Less ice"
                }
            ],
            "notes": "Test order from python client"
        }
        res = make_request(url, method="POST", data=data)
    elif operation == "price-override":
        url = f"{base_url}/db/local/menu-price-overrides"
        data = {
            "menuId": "22222222-2222-2222-2222-222222222222",
            "overridePrice": 25000,
            "reason": "Weekend promo via python client"
        }
        res = make_request(url, method="POST", data=data)
    elif operation == "submit-report":
        if node != "pusat":
            print("Error: Daily report submission is only allowed on the pusat node.")
            sys.exit(1)
        url = f"{base_url}/api/central/reports"
        data = {
            "branchCode": "tasikmalaya",
            "reportDate": datetime.now().strftime("%Y-%m-%d"),
            "totalOrders": 15,
            "totalItemsSold": 42,
            "grossSales": 850000,
            "netSales": 825000,
            "paymentCount": 13,
            "source": "REST_SYNC"
        }
        res = make_request(url, method="POST", data=data)
    else:
        print(f"Unknown operation: {operation}")
        sys.exit(1)
        
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()
