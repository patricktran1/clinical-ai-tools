# kidney_donor_pdf_parser.py
# Tool to extract raw text from kidney donor PDF intake forms

import fitz  # PyMuPDF

def extract_text_from_pdf(file_path):
    """Extracts text content from each page of the PDF."""
    doc = fitz.open(file_path)
    text = ""
    for page in doc:
        text += page.get_text()
    return text

def extract_key_data(raw_text):
    """Example placeholder function to identify key phrases."""
    fields = {
        "Donor Age": None,
        "Creatinine": None,
        "Blood Type": None
    }
    lines = raw_text.splitlines()
    for line in lines:
        if "Age" in line:
            fields["Donor Age"] = line
        if "Creatinine" in line:
            fields["Creatinine"] = line
        if "Blood Type" in line:
            fields["Blood Type"] = line
    return fields

if __name__ == '__main__':
    file_path = 'sample_kidney_donor_form.pdf'  # Replace with your actual file path
    text_output = extract_text_from_pdf(file_path)
    print("Raw Text Preview:")
    print(text_output[:500], "\n...")  # print first 500 characters

    key_data = extract_key_data(text_output)
    print("Extracted Key Data:")
    for k, v in key_data.items():
        print(f"{k}: {v}")
